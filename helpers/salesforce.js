var jsforce = require("jsforce");

exports.prepareConnection = (url) => {
    return new jsforce.Connection({
		loginUrl: url,
	});
}

exports.matchCaseWithCreneau = (cases, creneaux) => {
	var casesCreneaux = [];
	if (!cases.length || !creneaux.length) return casesCreneaux;
	for (var i = 0; i < creneaux.length; i++) {
		for (var j = 0; j < cases.length; j++) {
			var caseCreneau = { case: null, creneau: null };
			if (
				cases[j].DateHeureDebut__c ==
					creneaux[i].Debut_creneau__c/*  &&
				cases[j].DateHeureFin__c == creneaux[i].Fin_creneau__c */
			) {
				caseCreneau.case = cases[j];
				caseCreneau.creneau = creneaux[i];
				casesCreneaux.push(caseCreneau);
			}
		}
	}
	return casesCreneaux;
}