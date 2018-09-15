/*jslint node: true */
'use strict';
const desktopApp = require('byteballcore/desktop_app.js');
const conf = require('byteballcore/conf');

/**
 * responses for clients
 */
exports.greeting = () => {
	let rewards = conf.arrReputationRewardsInUsd.map(bracket => "Reputation "+bracket.threshold+" or above: $"+bracket.rewardInUsd.toLocaleString([], {minimumFractionDigits: 2})+" reward").join("\n");
	return [
		"Here you can attest your steem username.\n\n",

		"Your steem username will be linked to your Byteball address, the link can be either made public (if you choose so) or saved privately in your wallet. ",
		"In the latter case, only a proof of attestation will be posted publicly on the distributed ledger. ",
		"\n\n",

		conf.bAllowProofByPayment ? `The price of attestation is ${conf.priceInBytes/1e9} GB.  The payment is nonrefundable even if the attestation fails for any reason.\n\n` : '',

		`After you successfully attest your steem username for the first time, `,
		`you receive a reward in Bytes that depends on your reputation in Steem:\n\n${rewards}\n\nHalf of the reward will be immediately available, the other half will be locked on a smart contract and can be spent after 1 year.`
	].join('');
};

exports.weHaveReferralProgram = (user_address) => {
	const device = require('byteballcore/device.js');
	const invite_code = "byteball:"+device.getMyDevicePubKey()+"@"+conf.hub+"#"+user_address;
	const qr_url = conf.site+"/qr/?code="+ encodeURIComponent(invite_code);
	return [
		"Remember, we have a referral program: you get rewards by recommending new users to link their Steem and Byteball accounts.  There are "+(conf.bAllowProofByPayment ? 4 : 3)+" ways to do it and ensure that the referrals are tracked to you:\n" +
		(conf.bAllowProofByPayment ? "➡ you send Bytes from your attested address to a new user who is not attested yet, and he/she uses those Bytes to pay for a successful attestation;\n" : "") +
		"➡ have new users scan this QR code with wallet app "+qr_url+" , which opens this attestation bot in the user's wallet, the wallet has to be already installed;\n" +
		"➡ have new users copy-paste this to \"Chat > Add a new device > Accept invitation from the other device\" "+invite_code+" , which opens this attestation bot in the user's wallet, the wallet has to be already installed;\n" +
		"➡ have new users click this link (you can publish it e.g. on your blog) "+conf.site+"/#"+user_address+" which sets a tracking cookie and redirects to wallet download.\n\n" +
		`Your reward is exactly same as the new user's reward.  25% of your reward will be immediately available, the other 75% will be locked on a smart contract and can be spent after 1 year.`
	].join('');
};

exports.insertMyAddress = () => {
	return [
		"Please send me your address that you wish to attest (click ... and Insert my address).\n",
		"Make sure you are in a single-address wallet. ",
		"If you don't have a single-address wallet, ",
		"please add one (burger menu, add wallet) and fund it with the amount sufficient to pay for the attestation."
	].join('');
};


exports.goingToAttestAddress = (address) => {
	return `Thanks, going to attest your BB address: ${address}.`;
};

exports.privateOrPublic = () => {
	return [
		"Store your steem username privately in your wallet or post it publicly?\n\n",
		"[private](command:private)\t[public](command:public)"
	].join('');
};

exports.privateChosen = () => {
	return [
		"Your steem username will be kept private and stored in your wallet.\n",
		"Click [public](command:public) now if you changed your mind."
	].join('');
};

exports.publicChosen = (username) => {
	return [
		"Your steem username "+username+" will be posted into the public database and will be visible to everyone.  You cannot remove it later.\n\n",
		"Click [private](command:private) now if you changed your mind."
	].join('');
};

exports.pleasePay = (receivingAddress, price, challenge) => {
	if (conf.bAllowProofByPayment){
		let text = `Please pay for the attestation: [attestation payment](byteball:${receivingAddress}?amount=${price}).\n\nAlternatively, you can prove ownership of your address by signing a message: [message](sign-message-request:${challenge})`;
		text +=  (conf.signingRewardShare === 1) ? '.' : `, in this case your attestation reward (if any) will be ${conf.signingRewardShare*100}% of the normal reward.`;
		return text;
	}
	else
		return `Please prove ownership of your address by signing a message: [message](sign-message-request:${challenge}).`;
};

exports.pleasePayOrPrivacy = (receivingAddress, price, challenge, postPublicly) => {
	return (postPublicly === null) ? exports.privateOrPublic() : exports.pleasePay(receivingAddress, price, challenge);
};


exports.receivedAndAcceptedYourPayment = (amount) => {
	return `Received your payment of ${amount/1e9} GB.`;
};

exports.receivedYourPayment = (amount) => {
	return `Received your payment of ${amount/1e9} GB, waiting for confirmation. It should take 5-15 minutes.`;
};

exports.paymentIsConfirmed = () => {
	return "Your payment is confirmed.";
};


exports.attestedFirstTimeBonus = (rewardInUSD, rewardInBytes, contractRewardInBytes, vesting_ts) => {
	let contractRewardInUSD = rewardInUSD * conf.rewardContractShare;
	let cashRewardInUSD = rewardInUSD - contractRewardInUSD;
	let text = `You attested your steem username for the first time and will receive a welcome bonus of $${cashRewardInUSD.toLocaleString([], {minimumFractionDigits: 2})} (${(rewardInBytes/1e9).toLocaleString([], {maximumFractionDigits: 9})} GB) from Byteball distribution fund.`;
	if (contractRewardInBytes)
		text += "  You will also receive a reward of $"+contractRewardInUSD.toLocaleString([], {minimumFractionDigits: 2})+" ("+(contractRewardInBytes/1e9).toLocaleString([], {maximumFractionDigits: 9})+" GB) that will be locked on a smart contract for "+conf.contractTerm+" year and can be spent only after "+new Date(vesting_ts).toDateString()+".";
	return text;
};

exports.referredUserBonus = (referralRewardInUSD, referralRewardInBytes, contractReferralRewardInBytes, referrer_vesting_date_ts, username) => {
	let contractReferralRewardInUSD = referralRewardInUSD * conf.referralRewardContractShare;
	let cashReferralRewardInUSD = referralRewardInUSD - contractReferralRewardInUSD;
	let text =  `You referred user ${username} who has just verified his steem username and you will receive a reward of $${cashReferralRewardInUSD.toLocaleString([], {minimumFractionDigits: 2})} (${(referralRewardInBytes/1e9).toLocaleString([], {maximumFractionDigits: 9})} GB) from Byteball distribution fund.`;
	if (contractReferralRewardInBytes)
		text += "  You will also receive a reward of $"+contractReferralRewardInUSD.toLocaleString([], {minimumFractionDigits: 2})+" ("+(contractReferralRewardInBytes/1e9).toLocaleString([], {maximumFractionDigits: 9})+" GB) that will be locked on a smart contract for "+conf.contractTerm+" year and can be spent only after "+new Date(referrer_vesting_date_ts).toDateString()+".";
	text += `\n\nThank you for bringing in a new byteballer, the value of the ecosystem grows with each new user!`;
	return text;
};


exports.switchToSingleAddress = () => {
	return "Make sure you are in a single-address wallet, otherwise switch to a single-address wallet or create one and send me your address before paying.";
};

exports.alreadyAttested = (attestationDate) => {
	return `You were already attested at ${attestationDate} UTC. Attest [again](command: again)?`;
};

exports.currentAttestationFailed = () => {
	return "Your attestation failed. Try [again](command: again)?";
};
exports.previousAttestationFailed = () => {
	return "Your previous attestation failed. Try [again](command: again)?";
};

exports.proveUsername = (link) => {
	return "To let us know your steem username and to prove it, please follow this link "+link+" and log into your steem account, then return to this chat.";
};


/**
 * errors initialize bot
 */
exports.errorInitSql = () => {
	return "please import db.sql file\n";
};

exports.errorConfigEmail = () => {
	return `please specify admin_email and from_email in your ${desktopApp.getAppDataDir()}/conf.json\n`;
};

exports.errorConfigSalt = () => {
	return `please specify salt in your ${desktopApp.getAppDataDir()}/conf.json\n`;
};
