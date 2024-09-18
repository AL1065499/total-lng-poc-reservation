import 'dotenv/config';
import init from './helpers/init';

exports.handler = (event) => {
    init();
};
