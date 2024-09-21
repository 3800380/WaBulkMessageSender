const config = {
    NUMBER: process.env.NUMBER || '923072380380', // Fallback to default number if env var is not set
    SESSION_ID: process.env.SESSION_ID || '' // Fetch SESSION_ID from Heroku environment variables
};

module.exports = config;
