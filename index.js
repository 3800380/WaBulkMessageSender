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
let HamzaNumber = config.NUMBER;
function decodeBase64(_0x2b4491) {
    return Buffer.from(_0x2b4491, "base64").toString("utf-8");
}

const sessionDir = path.join(__dirname, "session");
if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir);
}

function saveDecodedSessionData(_0xc0c533) {
    const _0x1c1d04 = path.join(sessionDir, "creds.json");
    fs.writeFile(_0x1c1d04, JSON.stringify(_0xc0c533, null, 0x2), _0x4891e9 => {
        if (_0x4891e9) {
            console.error("Failed to save session data:", _0x4891e9.message);
            return;
        }
        console.log("Session data saved successfully.");
    });
}

if (!fs.existsSync(path.join(sessionDir, "creds.json"))) {
    if (config.SESSION_ID) {
        try {
            const decodedSessionId = Buffer.from(config.SESSION_ID.replace("Byte;;;", ''), 'base64').toString("utf-8");
            const sessionData = JSON.parse(decodedSessionId);
            saveDecodedSessionData(sessionData);
        } catch (_0x217cff) {
            console.error("Failed to save session ID:", _0x217cff.message);
        }
    } else {
        console.error("No SESSION_ID found!!!!!!!!!!!.");
    }
} else {
    console.log("Session already exists.");
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

let sentCount = 0;
let notSentCount = 0;
let remainingNumbers = [];

async function sendMessageWithRetry(sock, number, message, retries = 3) {
    try {
        await sock.sendMessage(number, { text: message });
        console.log(`Message sent to ${number}`);
        sentCount++;
    } catch (error) {
        if (error.output?.statusCode === 408 && retries > 0) {
            console.log(`Timeout occurred, retrying... (${3 - retries} retries left)`);
            await sendMessageWithRetry(sock, number, message, retries - 1);
        } else {
            console.error(`Failed to send message to ${number}:`, error);
            notSentCount++;
        }
    }
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
            console.log('Received a message without text.');
            return;
        }

        console.log(`${sender}: ${textMessage}`);

        if (textMessage.startsWith('/sendmsg')) {
            const commandParts = textMessage.split('|');

            if (commandParts.length !== 3) {
                await sock.sendMessage(sender, { text: 'Incorrect format, use: `/sendmsg <number file link> | <total numbers> | <message>`' });
                return;
            }

            const numberFileLink = commandParts[0].replace('/sendmsg ', '').trim();
            const totalNumbers = parseInt(commandParts[1].trim(), 10);
            const messageToSend = commandParts[2].trim();

            console.log('Number file link:', numberFileLink);
            console.log('Total numbers to send:', totalNumbers);
            console.log('Message to send:', messageToSend);

            try {
                const response = await axios.get(numberFileLink, { headers: { 'Accept': 'application/json' } });

                if (!response.data || !Array.isArray(response.data.numbers)) {
                    await sock.sendMessage(sender, { text: 'The file does not contain a valid "numbers" array.' });
                    console.log('Invalid file format:', response.data);
                    return;
                }

                let numbers = response.data.numbers;
                let validNumbers = [];

                if (numbers.length > 0) {
                    numbers = numbers.filter(number => number.trim());

                    for (const number of numbers) {
                        const isOnWhatsApp = await sock.onWhatsApp(number);

                        if (isOnWhatsApp && isOnWhatsApp.length > 0) {
                            validNumbers.push(number);
                            console.log(`Number ${number} is on WhatsApp.`);
                        } else {
                            console.log(`Number ${number} is not on WhatsApp.`);
                            notSentCount++;
                        }
                    }

                    if (validNumbers.length > 0) {
                        console.log('Sending messages to valid numbers...');

                        const useRandomDelay = config.USE_RANDOM_DELAY.toLowerCase() === 'true'; 
                        const customDelaySeconds = parseInt(config.DELAY_TIME, 10); 
function getDelay() {
    if (useRandomDelay) {
    
        const delayRange = config.RANDOM_DELAY_RANGE.split(',').map(Number); 
        const minDelay = delayRange[0] * 1000; 
        const maxDelay = delayRange[1] * 1000; 
        return Math.random() * (maxDelay - minDelay) + minDelay; 
        return customDelaySeconds * 1000; 
    }
}

                        let count = 0;
                        for (const validNumber of validNumbers) {
                            if (count >= totalNumbers) {
                                remainingNumbers.push(validNumber);
                                continue;
                            }

                            const formattedNumber = validNumber + '@s.whatsapp.net';
                            const uniqueMessage = messageToSend + '\n' + generateRandomString(6);

                            try {
                                await sendMessageWithRetry(sock, formattedNumber, uniqueMessage);

                                const delayTime = getDelay();
                                await delay(delayTime);
                                count++;
                            } catch (error) {
                                console.error(`Failed to send message to ${formattedNumber}`, error);
                            }
                        }

                        if (remainingNumbers.length > 0) {
                            console.log('Sending remaining numbers to 923072380380...');
                            const remainingNumbersMessage = `Remaining WhatsApp numbers:\n${remainingNumbers.join('\n')}`;
                            await sock.sendMessage(HamzaNumber + '@s.whatsapp.net', { text: remainingNumbersMessage });
                        }

                        console.log(`Total messages sent: ${sentCount}`);
                        console.log(`Total numbers not on WhatsApp: ${notSentCount}`);
                        await sock.sendMessage(HamzaNumber + '@s.whatsapp.net', { text: `*_${sentCount}_* numbers were on WhatsApp and received the message. *_${notSentCount}_* numbers were not on WhatsApp.` });
                        sentCount = 0;
                        notSentCount = 0;
                        remainingNumbers = [];

                        await sock.sendMessage(sender, { text: 'Messages processed. Check logs for skipped numbers.' });
                    } else {
                        await sock.sendMessage(sender, { text: 'No valid WhatsApp numbers found.' });
                    }
                } else {
                    await sock.sendMessage(sender, { text: 'No valid numbers found in the file.' });
                }
            } catch (error) {
                console.error('Error fetching numbers from link:', error.response ? error.response.data : error.message);
                await sock.sendMessage(sender, { text: 'Failed to fetch numbers from the provided link. Please check and try again.' });
            }

            return;
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWA().catch(err => console.log('Error connecting to WhatsApp:', err));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.listen(PORT, () => console.log(`Server running on PORT ${PORT}`));
