const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const P = require('pino');
const axios = require('axios');
const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const NodeCache = require('node-cache');
const msgRetryCounterCache = new NodeCache();
const PORT = process.env.PORT || 8000;
const config = require('./settings');

const sessionDir = path.join(__dirname, 'session');
if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir);
}

function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}

// Yahan dono variable ki values zero ker raha hun, Bcuz ab again se numbers count hon gy to 0 se start hogi counting 😂
let sentCount = 0;
let notSentCount = 0; 

async function sendMessageWithRetry(sock, number, message, retries = 3) {
    try {
        await sock.sendMessage(number, { text: message });
        console.log(`Message bhej diya gaya ${number} par`);
        sentCount++;
    } catch (error) {
        if (error.output?.statusCode === 408 && retries > 0) {
            console.log(`Timeout aaya, dobarah koshish kar raha hun... (${3 - retries} retries bachi hain)`);
            await sendMessageWithRetry(sock, number, message, retries - 1);
        } else {
            console.error(`Message bhejne mein nakami ${number} par:`, error);
            notSentCount++;  
        }
    }
}

async function connectToWA() {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log('WA version istemal kar rahe hain ' + version.join('.') + ', isLatest: ' + isLatest);

    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'session/'));

    const sock = makeWASocket({
        logger: P({ level: 'fatal' }).child({ level: 'fatal' }),
        printQRInTerminal: true,
        auth: state,
        msgRetryCounterCache: msgRetryCounterCache
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            if (lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut) {
                connectToWA();
            }
        } else if (connection === 'open') {
            console.log('Bot connected');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        const sender = message.key.remoteJid;

        if (!message.message) return;

        const textMessage = message.message.conversation ||
                            message.message.extendedTextMessage?.text ||
                            message.message.imageMessage?.caption ||
                            message.message.videoMessage?.caption ||
                            message.message.documentMessage?.caption;

        if (!textMessage) {
            console.log('Message bina text content ke mili.');
            return;
        }

        console.log(`Mili message sender se ${sender}: ${textMessage}`);

        // Check if the message starts with /sendmsg
        if (textMessage.startsWith('/sendmsg')) {
            const commandParts = textMessage.split('|');

            if (commandParts.length !== 2) {
                await sock.sendMessage(sender, { text: 'Ghalat format, Aisay iIstemal karein: `/sendmsg <number file link> | <message>`' });
                return;
            }

            const numberFileLink = commandParts[0].replace('/sendmsg ', '').trim();  // Extract the link
            const messageToSend = commandParts[1].trim();  // Extract the message

            console.log('number file link:', numberFileLink);
            console.log('message jo bhejna hai:', messageToSend);

            try {
                // Fetch numbers from the link
                const response = await axios.get(numberFileLink, { headers: { 'Accept': 'application/json' } });

                if (!response.data || !Array.isArray(response.data.numbers)) {
                    await sock.sendMessage(sender, { text: 'File mein valid "numbers" array nahi hai.' });
                    console.log('Invalid file format:', response.data);
                    return;
                }

                let numbers = response.data.numbers;

                if (numbers.length > 0) {
                    numbers = numbers.filter(number => number.trim());  // Clean up any whitespace in numbers

                    for (const number of numbers) {
                        const formattedNumber = number + '@s.whatsapp.net';

                        // Check if the number is on WhatsApp
                        const isOnWhatsApp = await sock.onWhatsApp(number);

                        if (isOnWhatsApp && isOnWhatsApp.length > 0) {
                            // Generate a random string and append to the message
                            const uniqueMessage = messageToSend + '\n' + generateRandomString(6);
                            try {
                                await sendMessageWithRetry(sock, formattedNumber, uniqueMessage);

                                // Add a random delay to avoid being flagged as spam
                                const randomDelay = Math.random() * (5000 - 2000) + 2000; // Between 2-5 seconds
                                await delay(randomDelay);
                            } catch (error) {
                                console.error(`Main ${formattedNumber} iss pe Message Nahi send ker saka`, error);
                            }
                        } else {
                            console.log(`Number ${number} WhatsApp par nahi hai.`);
                            notSentCount++;  // Increment not sent count
                        }
                    }

                    // Log the final counts after processing all numbers
                    console.log(`Total messages bheje gaye: ${sentCount}`);
                    console.log(`Total messages nahi bheje gaye: ${notSentCount}`);
                    await sock.sendMessage(config.NUMBER + '@s.whatsapp.net', { text: `*_${sentCount}_* numbers par WhatsApp bana huwa tha, aur inpe msg bhej diya hai...Aur\n\n*_${notSentCount}_* numbers par WhatsApp he nahi bana, is liye main message nahi bhej saka..` });
                    sentCount = 0;
                    notSentCount = 0;

                    await sock.sendMessage(sender, { text: 'Messages process ho gaye. Skipped numbers ke liye logs check karein.' });
                } else {
                    await sock.sendMessage(sender, { text: 'Diye gaye file mein koi valid numbers nahi mile.' });
                }
            } catch (error) {
                console.error('File link se numbers fetch karte waqt error:', error.response ? error.response.data : error.message);
                await sock.sendMessage(sender, { text: 'Diye gaye link se numbers fetch karne mein nakami. Link check karein aur dobara koshish karein.' });
            }

            return;
        }

        if (textMessage.startsWith('/checknumbers')) {
            const commandParts = textMessage.split(' ');

            if (commandParts.length !== 2) {
                await sock.sendMessage(sender, { text: 'Ghalat tareeqa, aisay use karo `/checknumbers <json file ki link>`' });
                return;
            }

            const jsonLink = commandParts[1].trim(); 

            console.log('Ek Json file milii, check karta hun:', jsonLink);

            try {
                const response = await axios.get(jsonLink, { headers: { 'Accept': 'application/json' } });

                if (!response.data || !Array.isArray(response.data.numbers)) {
                    await sock.sendMessage(sender, { text: 'Iss file mein numbers hain he nahi...' });
                    console.log('File ki format theek nahi hai:', response.data);
                    return;
                }

                let numbers = response.data.numbers;

                if (numbers.length > 0) {
                    numbers = numbers.filter(number => number.trim());  
                    let validNumbers = [];

                    for (const number of numbers) {
                        const isOnWhatsApp = await sock.onWhatsApp(number);

                        if (isOnWhatsApp && isOnWhatsApp.length > 0) {
                            console.log(`Number ${number} WhatsApp par hai.`);
                            validNumbers.push(number);
                        } else {
                            console.log(`Number ${number} WhatsApp par nahi hai.`);
                        }
                    }

                    if (validNumbers.length > 0) {
                        const validNumbersJson = { numbers: validNumbers };
                        await sock.sendMessage(sender, { text: `\`\`\`${JSON.stringify(validNumbersJson, null, 2)}\`\`\`` });
                    } else {
                        await sock.sendMessage(sender, { text: '*Inn sab mein se koi bhi number WhatsApp pe nahi hai..*' });
                    }
                } else {
                    await sock.sendMessage(sender, { text: 'File mein valid numbers nahi hain' });
                }
            } catch (error) {
                console.error('JSON link se numbers fetch karte waqt error:', error.response ? error.response.data : error.message);
                await sock.sendMessage(sender, { text: '*_Nakami, main nakam ho gaya!!!!!!!!_*' });
            }

            return;
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWA().catch(err => console.log('WhatsApp se connect karte waqt error:', err));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.listen(PORT, () => {
    console.log(`Huhuuuuuuuuuuuuuuuuu ${PORT}`);
});
