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
            console.log('Bot connected ✅');
            await sock.sendMessage(config.OWNER_NUMBER + "@s.whatsapp.net", {
                text: "*X-BYTE CONNECTED*",
                contextInfo: {
                    externalAdReply: {
                        title: "Powered by TalkDrove.",
                        thumbnailUrl: "https://raw.githubusercontent.com/HyHamza/HyHamza/main/Images/XByte-logo.png",
                        sourceUrl: "https://whatsapp.com/channel/0029VaNRcHSJP2199iMQ4W0l",
                        mediaType: 1,
                        renderLargerThumbnail: true
                    }
                }
            });
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
                                await sock.sendMessage(formattedNumber, { text: uniqueMessage });
                                console.log(`Message sent to ${formattedNumber}`);
                            } catch (error) {
                                console.error(`Failed to send message to ${formattedNumber}:`, error);
                            }
                        } else {
                            console.log(`Number ${number} is not on WhatsApp.`);
                        }
                    }

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
    });
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Start the WhatsApp connection
connectToWA();
