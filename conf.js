/*jslint node: true */
"use strict";
exports.port = null;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
exports.bLight = false;

exports.storage = 'sqlite';

// TOR is recommended. If you don't run TOR, please comment the next two lines
exports.socksHost = '127.0.0.1';
exports.socksPort = 9050;

exports.hub = 'byteball.org/bb';
exports.deviceName = 'Steem attestation bot';
exports.permanent_pairing_secret = '*';
exports.control_addresses = [''];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';

exports.bIgnoreUnpairRequests = true;
exports.bSingleAddress = false;
exports.bStaticChangeAddress = true;
exports.KEYS_FILENAME = 'keys.json';

// smtp
exports.bUseSmtp = false;

// emails
exports.admin_email = '';
exports.from_email = '';

// witnessing
exports.bRunWitness = false;
exports.THRESHOLD_DISTANCE = 20;
exports.MIN_AVAILABLE_WITNESSINGS = 100;

exports.priceInBytes = 49000;
exports.bAcceptUnconfirmedPayments = true;

exports.MAX_REFERRAL_DEPTH = 5;

exports.arrReputationRewardsInUsd = [
//	{threshold: 25, rewardInUsd: 0.02},
//	{threshold: 35, rewardInUsd: 5},
	{threshold: 40, rewardInUsd: 10},
	{threshold: 50, rewardInUsd: 40},
	{threshold: 60, rewardInUsd: 80},
	{threshold: 70, rewardInUsd: 160},
];

exports.signingRewardShare = 1;

exports.rewardContractShare = 0.5;
exports.referralRewardContractShare = 0.75;

exports.contractTerm = 1; // years
exports.contractUnclaimedTerm = 2; // years

exports.TIMESTAMPER_ADDRESS = 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT'; // isTestnet ? 'OPNUXBRSSQQGHKQNEPD2GLWQYEUY5XLD' : 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT'

exports.site = 'https://steem-byteball.org';

// steemconnect
exports.steemconnectApp = 'byteballapp';
exports.steemconnectRedirectUrl = exports.site + '/done';

exports.webPort = 8080;
