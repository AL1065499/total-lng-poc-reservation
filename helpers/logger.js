const log4js = require('log4js');
const path = require('path');
var moment = require("moment");
const logger = log4js.getLogger();
const fs = require('fs');

logger.level = 'debug';

exports.logging = (pathLog, message, filepath, type = 'info') => {
    if (process.env.SERVERLESS) {
        console.log(message)
    } else {
        if (message && filepath) {
            let filename = path.basename(filepath);
            logger[type](filename, message);
            fs.appendFileSync('logs/' + pathLog, moment().format('YYYY-MM-DD HH:mm:SS') + ' ' + message + '\n');
        } else {
            logger.error("Message AND/OR filename null in logger");
        }
    }
}
