var moment = require("moment-timezone");
const Queue = require("better-queue");
const { logging } = require('./logger');
const { prepareConnection, matchCaseWithCreneau } = require('./salesforce');
const { setTimeoutPromise } = require('./timer');

const _FN = __filename;

const logName = moment().format('YYYYMMDDHHmmSS') + '.txt';

const init = async () => {
    // connection to MyPocket
	let connMyPocket = prepareConnection(process.env.POCKET_URL);
	try {
		await connMyPocket.login(process.env.POCKET_USERNAME, process.env.POCKET_PASSWORD);
		logging(logName, 'Success connection to mypocket', _FN);
	} catch (e) {
		logging(logName, 'Error connection mypocket', _FN, 'error');
		logging(logName, e, _FN);
		return;
	}

	// get elengy ids from mypocket Custom Settings
	let CS001_TerminalInformations;
	try {
		let query = "SELECT User__c, Password__c FROM CS001_TerminalInformations__c WHERE Name = '" + process.env.POCKET_CUSTOMSETTINGS_ELENGYNAME + "'";
		CS001_TerminalInformations = await connMyPocket.query(query);

		if (CS001_TerminalInformations.totalSize && CS001_TerminalInformations.totalSize < 1) {
			throw('Empty custom settings on MyPocket');
		}

		CS001_TerminalInformations = CS001_TerminalInformations.records[0];
	} catch (e) {
		logging(logName, 'Error getting custom settings', _FN, 'error');
		logging(logName, e, _FN);
		return;
	}
	
	// connection to Elengy
	let connElengy = prepareConnection(process.env.ELENGY_URL);
	try {
		await connElengy.login(CS001_TerminalInformations.User__c, CS001_TerminalInformations.Password__c);
		logging(logName, 'Success connection to Elengy', _FN);
	} catch (e) {
		logging(logName, 'Error connection Elengy', _FN, 'error');
		logging(logName, e, _FN, 'error');
		return;
	}

	// pick the terminal to process
	let terminal = 'MontoirBretagne'//await selectTerminal();
	
	// get Automated_booking_value__c values
	let Automated_booking_values = {};
	try {
		let Automated_booking_value = await connMyPocket.query(
			`SELECT Id, Terminal_truckit_id__c, Approval__c, Chauffeur__c, Chauffeur_truckit_id__c, Citerne__c, 
			Citerne_truckit_id__c, Client__c, Terminal__c, Terminal__r.Name, Tracteur__c, Tracteur_truckit_id__c, Transporteur__c, 
			Transporteur_truckit_Id__c FROM Automated_booking_value__c`,
		);

		if (Automated_booking_value.totalSize < 1) {
			throw('Empty Automated_booking_value on MyPocket');
		}

		Automated_booking_value.records.forEach(e => {
			Automated_booking_values[e.Terminal__r.Name] = e;
		});
	} catch (e) {
		logging(logName, 'Error Automated_booking_value on my pocket', _FN, 'error');
		logging(logName, e, _FN);
		return;
	}

	// get ContractName__mdt values
	let ContractName;
	let ContractNameTonkin;
	try {
		ContractName = await connMyPocket.query(
			`SELECT Client_External_Id__c, Contract_Id__c, Client_Name__c FROM ContractName__mdt WHERE DeveloperName = '${process.env.POCKET_MTD_CONTRACTNAME}'`,
		);

		if (ContractName.totalSize && ContractName.totalSize < 1) {
			throw('Empty ContractName on MyPocket');
		}
		ContractName = ContractName.records[0];

		ContractNameTonkin = await connMyPocket.query(
			`SELECT Client_External_Id__c, Contract_Id__c, Client_Name__c FROM ContractName__mdt WHERE DeveloperName = '${process.env.POCKET_MTD_CONTRACTNAME_TONKIN}'`,
		);

		if (ContractNameTonkin.totalSize && ContractNameTonkin.totalSize < 1) {
			throw('Empty ContractNameTonkin on MyPocket');
		}
		ContractNameTonkin = ContractNameTonkin.records[0];
	} catch (e) {
		logging(logName, 'Error ContractName on my pocket', _FN, 'error');
		logging(logName, e, _FN);
		return;
	}
	
	// get all open hours day for actual day
	// for now we need just the day for POC
	let timeStart = moment.tz('Europe/Paris').hour(1).minute(0).second(0).format("YYYY-MM-DDTHH:mm:ssZZ");
	let timeEnd = moment.tz('Europe/Paris').hour(23).minute(0).second(0).format("YYYY-MM-DDTHH:mm:ssZZ");
	let OpenHours;
	try {
		OpenHours = await connMyPocket.query(
			`SELECT DateHeureDebut__c, DateHeureFin__c FROM Case WHERE Tech_Truckit_Opening_DateTime__c > ${timeStart} AND Tech_Truckit_Opening_DateTime__c < ${timeEnd}`,
		);
			
		if (OpenHours.totalSize && OpenHours.totalSize < 1) {
			throw('Empty OpenHours on MyPocket');
		}
		
		OpenHours = OpenHours.records[0];
	} catch (e) {
		logging(logName, 'Error OpenHours on my pocket', _FN, 'error');
		logging(logName, e, _FN);
		return;
	}

	let terminaux;
	try {
		terminaux = await connMyPocket.query(`SELECT Id, Heure_de_reservation__c, Terminal__r.Name FROM 
		Pre_Reservation__c WHERE A_reserver__c = true`);

		terminaux = terminaux.records;
	} catch (error) {
		logging(logName, 'Error terminaux on my pocket', _FN, 'error');
		logging(logName, e, _FN);
		return;
	}

	let timeBookings = [];
	terminaux.forEach(e => {
		let heure = e.Heure_de_reservation__c.split(':')
		let result = {
			timeBooking: moment(OpenHours.DateHeureDebut__c).tz('Europe/Paris').hour(heure[0]).minute(heure[1]).second(0).format("YYYY-MM-DDTHH:mm:ssZZ"),
			automated: Automated_booking_values[e.Terminal__r.Name]
		}
		timeBookings.push(result);
	})

	let slots;
	try {
		let query = `SELECT Id, lockingUser__c, dateOpenBeforeEdit__c, Numero_de_Baie__c, isLocked__c, Creneau_reservable__c, Debut_creneau__c, Fin_creneau__c, Agenda__c, IUR__c, Terminal__c FROM Creneau__c WHERE `;
		timeBookings.forEach((e, i) => {
			query += i === 0 ? '' : 'or '
			query += `(Debut_creneau__c = ${e.timeBooking} and Agenda__r.Terminal__c = '${e.automated.Terminal_truckit_id__c}') `
		})
		console.log(query)
		slots = await connElengy.query(query);
		if (slots.totalSize && slots.totalSize < 1) {
			throw('No time slot found on Elengy');
		}
		logging(logName, slots.totalSize + ' slots found on Elengy', _FN);
		slots = slots.records;
	} catch (e) {
		logging(logName, 'Error slot on Elengy', _FN, 'error');
		logging(logName, e, _FN);
		return;
	}

	// get all cases from mypocket associate with slots, loadingbaie
	let cases;
	let casesCreneaux;
	let hour;
	try {
		let query = `SELECT Id, DateHeureDebut__c, DateHeureFin__c, Terminal_name__c, TECH_heure__c FROM Case where `;
		timeBookings.forEach((e, i) => {
			query += i === 0 ? '' : 'or '
			query += `(Terminal__c = '${e.automated.Terminal__c}' and DateHeureDebut__c = ${e.timeBooking}) `
		})
		cases = await connMyPocket.query(query);

		if (cases.totalSize && cases.totalSize < 1) {
			throw('No cases found on MyPocket');
		}
		
		cases = cases.records;
		hour = cases[0].TECH_heure__c;
		casesCreneaux = matchCaseWithCreneau(cases, slots)
		if (casesCreneaux.length < 1) {
			throw('No matching between cases and slots');
		}
	} catch (e) {
		logging(logName, 'Error get cases on MyPocket', _FN, 'error');
		logging(logName, e, _FN);
		return;
	}

	logging(logName, 'Wait until 10:00:00', _FN);

	var tempReservationsToCreate = [];
	let matchTerminal = {
		Montoir: 'MontoirBretagne',
		Cavaou: 'Cavaou',
		Tonkin: 'FosTonkin'
	}

	casesCreneaux = casesCreneaux.filter((value, index, self) =>
		index === self.findIndex((t) => (
	  		t.creneau.Id === value.creneau.Id
		))
  	)

	casesCreneaux.forEach((caseCreneau, i) => {
		tempReservationsToCreate.push({
			Charger_quantite_max__c: true,
			Client__c: ContractName.Client_External_Id__c,
			Contrat_Elengy__c: ContractName.Contract_Id__c,
			Creneau__c: caseCreneau.creneau.Id,
			Transporteur__c: Automated_booking_values[matchTerminal[caseCreneau.creneau.Terminal__c]].Transporteur_truckit_Id__c,
			Citerne__c: Automated_booking_values[matchTerminal[caseCreneau.creneau.Terminal__c]].Citerne_truckit_id__c,
			Chauffeur__c: Automated_booking_values[matchTerminal[caseCreneau.creneau.Terminal__c]].Chauffeur_truckit_id__c,
			Tracteur__c: Automated_booking_values[matchTerminal[caseCreneau.creneau.Terminal__c]].Tracteur_truckit_id__c,
			IUR__c: caseCreneau.creneau.IUR__c,
			Prestation_Chargement__c: true,
			Prestation_Mise_en_froid__c: false,
			Prestation_Chargement_test__c: false,
			Prestation_Accreditation__c: false,
			Prestation_Autre__c: false,
			Reservation_annulee__c: false,
			TechRobot__c: true,
			Vendeur_GNL__c: (caseCreneau.creneau.Terminal__c == 'Tonkin') ? ContractNameTonkin.Client_External_Id__c : ContractName.Client_External_Id__c,
			Tech_VendeurGNLTexte__c: (caseCreneau.creneau.Terminal__c == 'Tonkin') ? ContractNameTonkin.Client_Name__c : ContractName.Client_Name__c,
		});
	});
	let timeLaunchBooking = moment.tz('Europe/Paris').hour(10).minute(00).second(00).millisecond(000);
	var log = await connElengy.soap.getServerTimestamp();
	let secondsUntilLaunchBooking = timeLaunchBooking.diff(moment(log.timestamp));
	await setTimeoutPromise(secondsUntilLaunchBooking);
	var timeElengy1 = await connElengy.soap.getServerTimestamp();
	logging(logName, 'Test' + JSON.stringify(timeElengy1), _FN);
	// start to get reservations
	logging(logName, 'Start reservations...', _FN);

	let logs = [];
	let reservations = [];
	let attempts = []
	let cursor = []

	
	try {
		let returnValue = await connElengy.sobject("Reservation__c").create(tempReservationsToCreate);
		var date1 = await connElengy.soap.getServerTimestamp();
		logging(logName, date1, _FN);
		returnValue.forEach((resa, i) => {
			if (resa.success) {
				logging(logName, "Start hour : " + moment(casesCreneaux[i].creneau.Debut_creneau__c).tz('Europe/Paris').format() + ", " + casesCreneaux[i].creneau.Terminal__c, _FN);
				logging(logName, "Slot RESERVED : " + resa.id + ", ", _FN);
				reservations.push(resa);
				logs.push({
					Name: moment(casesCreneaux[i].creneau.Debut_creneau__c).tz('Europe/Paris').format(),
					Date_Heure_de_debut__c: casesCreneaux[i].creneau.Debut_creneau__c,
					Succeded_Failed__c: true,
					Terminal__c: casesCreneaux[i].creneau.Terminal__c,
					Heure_du_Log__c: moment(date1.timestamp).tz('Europe/Paris').format()
				})
			} else {
				attempts.push(tempReservationsToCreate[i]);
				cursor.push(i)
				logging(logName, "Start hour : " + moment(casesCreneaux[i].creneau.Debut_creneau__c).tz('Europe/Paris').format() + ", " + casesCreneaux[i].creneau.Terminal__c, _FN);
				logging(logName, "Error reservation for slot " + tempReservationsToCreate[i].Creneau__c + ", ", _FN, 'error');
				for (var error of resa.errors) {
					logging(logName, error.message, _FN, 'error');
				}
			}
		})
		let returnValueAttempt = await connElengy.sobject("Reservation__c").create(attempts);
		var date2 = await connElengy.soap.getServerTimestamp();
		returnValueAttempt.forEach((resa, i) => {
			if (resa.success) {
				logging(logName, "Start hour : " + moment(casesCreneaux[cursor[i]].creneau.Debut_creneau__c).tz('Europe/Paris').format() + ", " + casesCreneaux[cursor[i]].creneau.Terminal__c, _FN);
				logging(logName, "Slot RESERVED attempt : " + resa.id + ", ", _FN);
				reservations.push(resa);
				logs.push({
					Name: moment(casesCreneaux[cursor[i]].creneau.Debut_creneau__c).tz('Europe/Paris').format(),
					Date_Heure_de_debut__c: casesCreneaux[cursor[i]].creneau.Debut_creneau__c,
					Succeded_Failed__c: true,
					Terminal__c: casesCreneaux[cursor[i]].creneau.Terminal__c,
					Heure_du_Log__c: moment(date2.timestamp).tz('Europe/Paris').format()
				})
			} else {
				logging(logName, "Start hour : " + moment(casesCreneaux[cursor[i]].creneau.Debut_creneau__c).tz('Europe/Paris').format() + ", " + casesCreneaux[cursor[i]].creneau.Terminal__c, _FN);
				logging(logName, "Error reservation for slot attempt " + tempReservationsToCreate[cursor[i]].Creneau__c + ", ", _FN, 'error');
				let e = '';
				for (var error of resa.errors) {
					logging(logName, error.message, _FN, 'error');
					e += error.message;
				}
				logs.push({
					Name: moment(casesCreneaux[cursor[i]].creneau.Debut_creneau__c).tz('Europe/Paris').format(),
					Date_Heure_de_debut__c: casesCreneaux[cursor[i]].creneau.Debut_creneau__c,
					Error_Message__c: e,
					Succeded_Failed__c: false,
					Terminal__c: casesCreneaux[cursor[i]].creneau.Terminal__c,
					Heure_du_Log__c: moment(date2.timestamp).tz('Europe/Paris').format()
				})
			}
		})
	} catch (error) {
		logging(logName, 'Error reservation on Elengy', _FN, 'error');
		logging(logName, error, _FN);
	}

	try {
		let returnValue = await connMyPocket.sobject("Robot_Log__c").create(logs);
		for (var c of returnValue) {
			if (c.success) {
				logging(logName, "Logs created : " + c.id, _FN);
			} else {
				logging(logName, 'Error create logs', _FN, 'error');
				logging(logName, c.errors, _FN, 'error');
			}
		}
	} catch (e) {
		logging(logName, 'Error created logs on MyPocket', _FN, 'error');
		logging(logName, e, _FN);
		return;
	}

	logging(logName, 'Wait until 10:03:00', _FN);
	let timeLaunchCase = moment().tz('Europe/Paris').hour(10).minute(3).second(00);
	let secondsUntilLaunchCase = timeLaunchCase.diff(moment());
	console.log(secondsUntilLaunchCase)
	await setTimeoutPromise(secondsUntilLaunchCase);
	
	// updated case that success reservated
	var tempCasesUpdates = [];
	casesCreneaux.map((caseCreneau, i) => {
		if (reservations[i] && reservations[i].success) {
			tempCasesUpdates.push({
				Id: caseCreneau.case.Id,
				Tech_TruckItEasyReservationId__c: reservations[i].id,
				Terminal_IUR__c: caseCreneau.creneau.IUR__c
					? caseCreneau.creneau.IUR__c.slice(
							caseCreneau.creneau.IUR__c.length - 4
						)
					: null,
			});
		}
	});


	try {
		let returnValue = await connMyPocket.sobject("Case").update(tempCasesUpdates);
		for (var c of returnValue) {
			if (c.success) {
				logging(logName, "Case updated : " + c.id, _FN);
			} else {
				logging(logName, 'Error case', _FN, 'error');
				logging(logName, c.errors, _FN, 'error');
			}
		}
	} catch (e) {
		logging(logName, 'Error updated case on MyPocket', _FN, 'error');
		logging(logName, e, _FN);
		return;
	}
}

module.exports = init;