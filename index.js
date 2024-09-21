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

// Create session directory if it doesn't exist
const sessionDir = path.join(__dirname, 'session');
if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir);
}

// Function to generate random strings to make messages unique
function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

// Function to delay between each message to avoid being flagged as spam
function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}

// Add counters for sent and not sent messages
let sentCount = 0;
let notSentCount = 0;

// Function to send messages with retry and random delay
async function sendMessageWithRetry(sock, number, message, retries = 3) {
    try {
        await sock.sendMessage(number, { text: message });
        console.log(`Message sent to ${number}`);
        sentCount++;  // Increment sent count
    } catch (error) {
        if (error.output?.statusCode === 408 && retries > 0) {
            console.log(`Timeout occurred, retrying... (${3 - retries} retries left)`);
            await sendMessageWithRetry(sock, number, message, retries - 1);
        } else {
            console.error(`Failed to send message to ${number}:`, error);
            notSentCount++;  // Increment not sent count
        }
    }
}

// Function to connect to WhatsApp
async function connectToWA() {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log('Using WA version ' + version.join('.') + ', isLatest: ' + isLatest);

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
            console.log('Received a message with no text content.');
            return;
        }

        console.log(`Received message from ${sender}: ${textMessage}`);

        // Check if the message starts with /sendmsg
        if (textMessage.startsWith('/sendmsg')) {
            const commandParts = textMessage.split('|');

            if (commandParts.length !== 2) {
                await sock.sendMessage(sender, { text: 'Invalid format. Use: /sendmsg <number file link> | <message>' });
                return;
            }

            const numberFileLink = commandParts[0].replace('/sendmsg ', '').trim();  // Extract the link
            const messageToSend = commandParts[1].trim();  // Extract the message

            console.log('Received number file link:', numberFileLink);
            console.log('Received message to send:', messageToSend);

            try {
                // Fetch numbers from the link
                const response = await axios.get(numberFileLink, { headers: { 'Accept': 'application/json' } });

                if (!response.data || !Array.isArray(response.data.numbers)) {
                    await sock.sendMessage(sender, { text: 'The file does not contain a valid "numbers" array.' });
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
                                console.error(`Failed to send message to ${formattedNumber}:`, error);
                            }
                        } else {
                            console.log(`Number ${number} is not on WhatsApp.`);
                            notSentCount++;  // Increment not sent count
                        }
                    }

                    // Log the final counts after processing all numbers
                    console.log(`Total messages sent: ${sentCount}`);
                    console.log(`Total messages not sent: ${notSentCount}`);
                    await sock.sendMessage(923072380380 + '@s.whatsapp.net', { text: `*_${sentCount}_* numbers par WhatsApp bana huwa tha, aur inpe msg send ker diya hai...Aur\n\n*_${notSentCount}_* numbers par WhatsApp he nahi bana, so Main message nahi send ker saka..` });
                    sentCount = 0;
                    notSentCount = 0;


                    await sock.sendMessage(sender, { text: 'Messages processed. Check logs for skipped numbers.' });
                } else {
                    await sock.sendMessage(sender, { text: 'No valid numbers found in the provided file.' });
                }
            } catch (error) {
                console.error('Error fetching numbers from file link:', error.response ? error.response.data : error.message);
                await sock.sendMessage(sender, { text: 'Failed to fetch numbers from the provided link. Please check the link and try again.' });
            }

            return;
        }

        // Check if the message starts with /checknumbers
        if (textMessage.startsWith('/checknumbers')) {
            const commandParts = textMessage.split(' ');

            if (commandParts.length !== 2) {
                await sock.sendMessage(sender, { text: 'Invalid format. Use: /checknumbers <json link>' });
                return;
            }

            const jsonLink = commandParts[1].trim();  // Extract the link

            console.log('Received JSON link for number checking:', jsonLink);

            try {
                // Fetch numbers from the JSON link
                const response = await axios.get(jsonLink, { headers: { 'Accept': 'application/json' } });

                if (!response.data || !Array.isArray(response.data.numbers)) {
                    await sock.sendMessage(sender, { text: 'The file does not contain a valid "numbers" array.' });
                    console.log('Invalid file format:', response.data);
                    return;
                }

                let numbers = response.data.numbers;

                if (numbers.length > 0) {
                    numbers = numbers.filter(number => number.trim());  // Clean up any whitespace in numbers
                    let validNumbers = [];

                    for (const number of numbers) {
                        // Check if the number is on WhatsApp
                        const isOnWhatsApp = await sock.onWhatsApp(number);

                        if (isOnWhatsApp && isOnWhatsApp.length > 0) {
                            console.log(`Number ${number} is on WhatsApp.`);
                            validNumbers.push(number);
                        } else {
                            console.log(`Number ${number} is not on WhatsApp.`);
                        }
                    }

                    if (validNumbers.length > 0) {
                        // Send the valid numbers in JSON format
                        const validNumbersJson = { numbers: validNumbers };
                        await sock.sendMessage(sender, { text: `\`\`\`${JSON.stringify(validNumbersJson, null, 2)}\`\`\`` });
                    } else {
                        await sock.sendMessage(sender, { text: 'None of the numbers are on WhatsApp.' });
                    }
                } else {
                    await sock.sendMessage(sender, { text: 'No valid numbers found in the provided file.' });
                }
            } catch (error) {
                console.error('Error fetching numbers from JSON link:', error.response ? error.response.data : error.message);
                await sock.sendMessage(sender, { text: 'Failed to fetch numbers from the provided link. Please check the link and try again.' });
            }

            return;
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWA().catch(err => console.log('Error connecting to WhatsApp:', err));

// Set up a basic Express server to handle requests
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
