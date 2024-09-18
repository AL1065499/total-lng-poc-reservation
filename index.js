const dotenv = require("dotenv");
var moment = require("moment");
const { logging } = require('./helpers/logger');
const { setTimeoutPromise } = require('./helpers/timer');
const init = require('./helpers/init');

dotenv.config();

const _FN = __filename;

const logName = moment().format('YYYYMMDDHHmmSS') + '.txt';

let timeLaunchService = moment().hour(9).minute(59).second(50);
let secondsUntilLaunchService = timeLaunchService.diff(moment());

logging(logName, "Numbers of milliseconds to wait : " + secondsUntilLaunchService, _FN);

(async () => {
	//await setTimeoutPromise(secondsUntilLaunchService);
	init();
})();