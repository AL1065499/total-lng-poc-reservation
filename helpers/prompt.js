const inquirer = require("inquirer");

const _FN = __filename;

exports.selectTerminal = async () => {
	// sélection des options de réservation par l'utilisateur
	let answers = await inquirer.prompt([{
		type: "list",
		name: "terminal",
		message: "Choisissez un terminal",
		choices: ["FosTonkin", "MontoirBretagne", "Cavaou"],
	}]);

    let terminal = answers.terminal;
    return terminal;
}