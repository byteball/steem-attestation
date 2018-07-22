/*jslint node: true */
'use strict';
const constants = require('byteballcore/constants.js');
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const validationUtils = require('byteballcore/validation_utils');
const mail = require('byteballcore/mail');
const texts = require('./modules/texts');
const reward = require('./modules/reward');
const contract = require('./modules/contract');
const conversion = require('./modules/conversion');
const steemAttestation = require('./modules/steem_attestation');
const notifications = require('./modules/notifications');
const sc2 = require('sc2-sdk');
const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

let api = sc2.Initialize({
	app: conf.steemconnectApp,
	callbackURL: conf.steemconnectRedirectUrl,
	scope: ['login']
});

function startWebServer(){
	const app = express();
	const server = require('http').Server(app);

	app.use(cookieParser());
	app.use(bodyParser.urlencoded({ extended: false }));

	app.get('/done', (req, res) => {
		let device = require('byteballcore/device.js');
		let query = req.query;
		let cookies = req.cookies;
		console.error('received request', query);
		if (!query.access_token || !query.state)
			return res.send("no access_token or unique_id");
		db.query("SELECT device_address, user_address FROM users WHERE unique_id=?", [query.state], rows => {
			if (rows.length === 0)
				return res.send("no such unique_id");
			let userInfo = rows[0];
			if (cookies.referrer && validationUtils.isValidAddress(cookies.referrer)){
				db.query("INSERT "+db.getIgnore()+" INTO link_referrals (referring_user_address, device_address, type) VALUES(?, ?, 'cookie')", 
					[cookies.referrer, userInfo.device_address]);
			}
			if (!userInfo.user_address){
				device.sendMessageToDevice(userInfo.device_address, 'text', texts.insertMyAddress());
				return res.send("Please return to chat, insert your address, and try again");
			}
			api.setAccessToken(query.access_token);
			api.me((err, meResult) => {
				console.error(err, meResult);
				if (err)
					return res.send("failed to get your steem profile");
				let is_eligible = (meResult.account.created < '2018-07-12');
				let username = meResult.account.name;
				let reputation = meResult.account.reputation;
				let log_reputation = Math.floor( Math.max(Math.log10(Math.abs(reputation)) - 9, 0) * ( (reputation >= 0) ? 1 : -1) * 9 ) + 25;
				db.query("UPDATE users SET username=? WHERE device_address=?", [username, userInfo.device_address], () => {
					userInfo.username = username;
					readOrAssignReceivingAddress(userInfo, (receiving_address, post_publicly) => {
						db.query("UPDATE receiving_addresses SET reputation=?, is_eligible=? WHERE receiving_address=?", [log_reputation, is_eligible, receiving_address]);

						let response = "Your steem username is "+username+".\n\n";
						let challenge = username + ' ' + userInfo.user_address;
						if (post_publicly === null)
							response += texts.privateOrPublic();
						else
							response += texts.pleasePay(receiving_address, conf.priceInBytes, challenge) + '\n\n' +
								((post_publicly === 0) ? texts.privateChosen() : texts.publicChosen(userInfo.username));
						device.sendMessageToDevice(userInfo.device_address, 'text', response);
					});
				});
				res.sendFile(__dirname+'/done.html');
			});
		});
	});

	app.get('/qr', (req, res) => {
		res.sendFile(__dirname+'/qr.html');
	});

	server.listen(conf.webPort, () => {
		console.log(`== server started listening on ${conf.webPort} port`);
	});
}

/**
 * user pairs his device with bot
 */
eventBus.on('paired', (from_address, pairing_secret) => {
	respond(from_address, '', texts.greeting());
	if (!validationUtils.isValidAddress(pairing_secret))
		return console.log("pairing without referrer in pairing code");
	let referring_user_address = pairing_secret;
	db.query(
		"SELECT 1 FROM attestations WHERE address=? AND attestor_address=?", 
		[referring_user_address, steemAttestation.steemAttestorAddress], 
		rows => {
			if (rows.length === 0)
				return console.log("referrer "+referring_user_address+" not attested, ignoring referrer pairing code");
			console.log("paired device "+from_address+" fererred by "+referring_user_address);
			db.query("INSERT "+db.getIgnore()+" INTO link_referrals (referring_user_address, device_address, type) VALUES(?, ?, 'pairing')", 
				[referring_user_address, from_address]);
		}
	);
});

/**
 * user sends message to the bot
 */
eventBus.once('headless_and_rates_ready', () => {  // we need rates to handle some messages
	const headlessWallet = require('headless-byteball');
	eventBus.on('text', (from_address, text) => {
		respond(from_address, text.trim());
	});
	if (conf.bRunWitness) {
		require('byteball-witness');
		eventBus.emit('headless_wallet_ready');
	} else {
		headlessWallet.setupChatEventHandlers();
	}
});

/**
 * user pays to the bot
 */
eventBus.on('new_my_transactions', handleNewTransactions);

/**
 * payment is confirmed
 */
if (!conf.bAcceptUnconfirmedPayments)
	eventBus.on('my_transactions_became_stable', handleTransactionsBecameStable);

/**
 * ready headless wallet
 */
eventBus.once('headless_wallet_ready', handleWalletReady);

function handleWalletReady() {
	let error = '';

	/**
	 * check if database tables are created
	 */
	let arrTableNames = [
		'users','receiving_addresses','transactions','attestation_units', 'accepted_payments','rejected_payments', 'signed_messages',
		'reward_units','referral_reward_units', 'contracts', 'link_referrals'
	];
	db.query("SELECT name FROM sqlite_master WHERE type='table' AND NAME IN (?)", [arrTableNames], (rows) => {
		if (rows.length !== arrTableNames.length) {
			error += texts.errorInitSql();
		}

		/**
		 * check if config is filled correct
		 */
		if (conf.bUseSmtp && (!conf.smtpHost || !conf.smtpUser || !conf.smtpPassword)) {
			error += texts.errorConfigSmtp();
		}
		if (!conf.admin_email || !conf.from_email) {
			error += texts.errorConfigEmail();
		}
		if (!conf.salt) {
			error += texts.errorConfigSalt();
		}

		if (error) {
			throw new Error(error);
		}

		const headlessWallet = require('headless-byteball');
		headlessWallet.issueOrSelectAddressByIndex(0, 0, (address1) => {
			console.log('== steem attestation address: ' + address1);
			steemAttestation.steemAttestorAddress = address1;

			headlessWallet.issueOrSelectAddressByIndex(0, 1, (address2) => {
				console.log('== distribution address: ' + address2);
				reward.distributionAddress = address2;

				setInterval(steemAttestation.retryPostingAttestations, 60*1000);
				setInterval(reward.retrySendingRewards, 60*1000);
				setInterval(moveFundsToAttestorAddresses, 60*1000);
				
				const consolidation = require('headless-byteball/consolidation.js');
				consolidation.scheduleConsolidation(steemAttestation.steemAttestorAddress, headlessWallet.signer, 100, 3600*1000);
				
				startWebServer();
			});
		});
	});
}

function moveFundsToAttestorAddresses() {
	let network = require('byteballcore/network.js');
	const mutex = require('byteballcore/mutex.js');
	if (network.isCatchingUp())
		return;

	mutex.lock(['moveFundsToAttestorAddresses'], unlock => {
		console.log('moveFundsToAttestorAddresses');
		db.query(
			`SELECT * FROM (
				SELECT DISTINCT receiving_address
				FROM receiving_addresses 
				CROSS JOIN outputs ON receiving_address = address 
				JOIN units USING(unit)
				WHERE is_stable=1 AND is_spent=0 AND asset IS NULL
			) AS t
			WHERE NOT EXISTS (
				SELECT * FROM units CROSS JOIN unit_authors USING(unit)
				WHERE is_stable=0 AND unit_authors.address=t.receiving_address AND definition_chash IS NOT NULL
			)
			LIMIT ?`,
			[constants.MAX_AUTHORS_PER_UNIT],
			(rows) => {
				// console.error('moveFundsToAttestorAddresses', rows);
				if (rows.length === 0) {
					return unlock();
				}

				let arrAddresses = rows.map(row => row.receiving_address);
				// console.error(arrAddresses, steemAttestation.steemAttestorAddress);
				let headlessWallet = require('headless-byteball');
				headlessWallet.sendMultiPayment({
					asset: null,
					to_address: steemAttestation.steemAttestorAddress,
					send_all: true,
					paying_addresses: arrAddresses
				}, (err, unit) => {
					if (err) {
						console.error("failed to move funds: " + err);
						let balances = require('byteballcore/balances');
						balances.readBalance(arrAddresses[0], (balance) => {
							console.error('balance', balance);
							notifications.notifyAdmin('failed to move funds', err + ", balance: " + JSON.stringify(balance));
							unlock();
						});
					}
					else{
						console.log("moved funds, unit " + unit);
						unlock();
					}
				});
			}
		);
	});
}


function handleNewTransactions(arrUnits) {
	let device = require('byteballcore/device.js');
	db.query(
		`SELECT
			amount, asset, unit,
			receiving_address, device_address, user_address, username, price, 
			${db.getUnixTimestamp('last_price_date')} AS price_ts
		FROM outputs
		CROSS JOIN receiving_addresses ON receiving_addresses.receiving_address = outputs.address
		WHERE unit IN(?)
			AND NOT EXISTS (
				SELECT 1
				FROM unit_authors
				CROSS JOIN my_addresses USING(address)
				WHERE unit_authors.unit = outputs.unit
			)`,
		[arrUnits],
		(rows) => {
			rows.forEach((row) => {

				checkPayment(row, (error) => {
					if (error) {
						return db.query(
							`INSERT ${db.getIgnore()} INTO rejected_payments
							(receiving_address, price, received_amount, payment_unit, error)
							VALUES (?,?,?,?,?)`,
							[row.receiving_address, row.price, row.amount, row.unit, error],
							() => {
								device.sendMessageToDevice(row.device_address, 'text', error);
							}
						);
					}

					db.query(`INSERT INTO transactions (receiving_address, proof_type) VALUES (?, 'payment')`, [row.receiving_address], (res) => {
						let transaction_id = res.insertId;
						db.query(
							`INSERT INTO accepted_payments
							(transaction_id, receiving_address, price, received_amount, payment_unit)
							VALUES (?,?,?,?,?)`,
							[transaction_id, row.receiving_address, row.price, row.amount, row.unit],
							() => {
								if (conf.bAcceptUnconfirmedPayments){
									device.sendMessageToDevice(row.device_address, 'text', texts.receivedAndAcceptedYourPayment(row.amount));
									handleTransactionsBecameStable([row.unit]);
								}
								else
									device.sendMessageToDevice(row.device_address, 'text', texts.receivedYourPayment(row.amount));
							}
						);
					});

				}); // checkPayment

			});
		}
	);
}

function checkPayment(row, onDone) {
	if (row.asset !== null) {
		return onDone("Received payment in wrong asset");
	}

	if (row.amount < conf.priceInBytes) {
		let text = `Received ${row.amount} Bytes from you, which is less than the expected ${conf.priceInBytes} Bytes.`;
		let challenge = row.username + ' ' + row.user_address;
		return onDone(text + '\n\n' + texts.pleasePay(row.receiving_address, conf.priceInBytes, challenge));
	}

	function resetUserAddress(){
		db.query("UPDATE users SET user_address=NULL WHERE device_address=?", [row.device_address]);
	}
	
	db.query("SELECT address FROM unit_authors WHERE unit=?", [row.unit], (author_rows) => {
		if (author_rows.length !== 1){
			resetUserAddress();
			return onDone("Received a payment but looks like it was not sent from a single-address wallet.  "+texts.switchToSingleAddress());
		}
		if (author_rows[0].address !== row.user_address){
			resetUserAddress();
			return onDone("Received a payment but it was not sent from the expected address "+row.user_address+".  "+texts.switchToSingleAddress());
		}
		onDone();
	});
}

function handleTransactionsBecameStable(arrUnits) {
	let device = require('byteballcore/device.js');
	db.query(
		`SELECT transaction_id, device_address, user_address, username, reputation, is_eligible, post_publicly, payment_unit
		FROM accepted_payments
		JOIN receiving_addresses USING(receiving_address)
		WHERE payment_unit IN(?)`,
		[arrUnits],
		(rows) => {
			rows.forEach((row) => {
				db.query(
					`UPDATE accepted_payments SET confirmation_date=${db.getNow()}, is_confirmed=1 WHERE transaction_id=?`,
					[row.transaction_id],
					() => {
						if (!conf.bAcceptUnconfirmedPayments)
							device.sendMessageToDevice(row.device_address, 'text', texts.paymentIsConfirmed());
						attest(row, 'payment');
					}
				);
			}); // forEach
		}
	);
}


function attest(row, proof_type){
	let device = require('byteballcore/device.js');
	const mutex = require('byteballcore/mutex.js');
	let transaction_id = row.transaction_id;
	if (row.reputation === null)
		throw Error("attest: no rep in tx "+transaction_id);
	mutex.lock(['tx-'+transaction_id], unlock => {
		db.query(
			`INSERT ${db.getIgnore()} INTO attestation_units (transaction_id) VALUES (?)`,
			[transaction_id],
			() => {

				let	[attestation, src_profile] = steemAttestation.getAttestationPayloadAndSrcProfile(
					row.user_address,
					row.username,
					row.reputation,
					row.post_publicly
				);

				steemAttestation.postAndWriteAttestation(
					transaction_id,
					steemAttestation.steemAttestorAddress,
					attestation,
					src_profile
				);

				let rewardInUSD = getRewardInUSDByReputation(row.reputation);
				if (!rewardInUSD)
					return unlock();

				if (row.is_eligible === 0){
					console.log('user '+row.username+' '+row.user_address+' is not eligible for reward');
					device.sendMessageToDevice(row.device_address, 'text', "You are not eligible for attestation reward as your account was created after Jul 12, but you can still refer new users and earn referral rewards.");
					return unlock();
				}
				
				if (proof_type === 'signature')
					rewardInUSD *= conf.signingRewardShare;

				let fullRewardInBytes = conversion.getPriceInBytes(rewardInUSD);
				let rewardInBytes = Math.round(fullRewardInBytes * conf.rewardContractShare);
				let contractRewardInBytes = Math.round(fullRewardInBytes * (1-conf.rewardContractShare));
				db.query(
					`INSERT ${db.getIgnore()} INTO reward_units
					(transaction_id, device_address, user_address, username, user_id, reward, contract_reward)
					VALUES (?, ?,?,?,?, ?,?)`,
					[transaction_id, row.device_address, row.user_address, row.username, attestation.profile.user_id, rewardInBytes, contractRewardInBytes],
					async (res) => {
						console.error(`reward_units insertId: ${res.insertId}, affectedRows: ${res.affectedRows}`);
						if (!res.affectedRows){
							console.log(`duplicate user_address or user_id: ${row.user_address}, ${attestation.profile.user_id}`);
							return unlock();
						}
						
						let [contract_address, vesting_ts] = await contract.createContract(row.user_address, row.device_address);
						device.sendMessageToDevice(row.device_address, 'text', texts.attestedFirstTimeBonus(rewardInUSD, rewardInBytes, contractRewardInBytes, vesting_ts));
						reward.sendAndWriteReward('attestation', transaction_id);

						let referralRewardInUSD = getRewardInUSDByReputation(row.reputation);
						if (!referralRewardInUSD)
							return unlock();

						let referralRewardInBytes = 
							conversion.getPriceInBytes(referralRewardInUSD * (1-conf.referralRewardContractShare));
						let contractReferralRewardInBytes = 
							conversion.getPriceInBytes(referralRewardInUSD * conf.referralRewardContractShare);
						reward.findReferrer(
							row.payment_unit, row.user_address, row.device_address,
							async (referring_user_id, referring_user_address, referring_user_device_address) => {
								if (!referring_user_address) {
									// console.error("no referring user for " + row.user_address);
									console.log("no referring user for " + row.user_address);
									return unlock();
								}
								let [referrer_contract_address, referrer_vesting_date_ts] = 
									await contract.getReferrerContract(referring_user_address, referring_user_device_address);

								db.query(
									`INSERT ${db.getIgnore()} INTO referral_reward_units
									(transaction_id, user_address, user_id, new_user_address, new_user_id, reward, contract_reward)
									VALUES (?, ?,?, ?,?, ?,?)`,
									[transaction_id,
										referring_user_address, referring_user_id,
										row.user_address, attestation.profile.user_id,
										referralRewardInBytes, contractReferralRewardInBytes],
									(res) => {
										console.log(`referral_reward_units insertId: ${res.insertId}, affectedRows: ${res.affectedRows}`);
										if (!res.affectedRows){
											notifications.notifyAdmin("duplicate referral reward", `referral reward for new user ${row.user_address} ${attestation.profile.user_id} already written`);
											return unlock();
										}

										device.sendMessageToDevice(referring_user_device_address, 'text', texts.referredUserBonus(referralRewardInUSD, referralRewardInBytes, contractReferralRewardInBytes, referrer_vesting_date_ts, row.username));
										reward.sendAndWriteReward('referral', transaction_id);
										unlock();
									}
								);
							}
						);

					}
				);

			}
		);
	});
}


/**
 * scenario for responding to user requests
 * @param from_address
 * @param text
 * @param response
 */
function respond(from_address, text, response = '') {
	let device = require('byteballcore/device.js');
	const mutex = require('byteballcore/mutex.js');
	readUserInfo(from_address, (userInfo) => {

		function checkUserAddress(onDone) {
			if (validationUtils.isValidAddress(text)) {
				userInfo.user_address = text;
				userInfo.username = null;
				response += texts.goingToAttestAddress(userInfo.user_address);
				return db.query(
					'UPDATE users SET user_address=? WHERE device_address=?',
					[userInfo.user_address, from_address],
					() => {
						onDone();
					}
				);
			}
			if (userInfo.user_address)
				return onDone();
			onDone(texts.insertMyAddress());
		}

		function checkUsername(onDone) {
			if (userInfo.username)
				return onDone();
			let link = api.getLoginURL(userInfo.unique_id);
			onDone(texts.proveUsername(link));
		}

		checkUserAddress((userAddressResponse) => {
			if (userAddressResponse)
				return device.sendMessageToDevice(from_address, 'text', (response ? response + '\n\n' : '') + userAddressResponse);

			checkUsername((usernameResponse) => {
				if (usernameResponse)
					return device.sendMessageToDevice(from_address, 'text', (response ? response + '\n\n' : '') + usernameResponse);

				readOrAssignReceivingAddress(userInfo, (receiving_address, post_publicly) => {
					let price = conf.priceInBytes;

					if (text === 'private' || text === 'public') {
						post_publicly = (text === 'public') ? 1 : 0;
						db.query(
							`UPDATE receiving_addresses 
							SET post_publicly=? 
							WHERE device_address=? AND user_address=? AND username=?`,
							[post_publicly, from_address, userInfo.user_address, userInfo.username]
						);
						response += (text === "private") ? texts.privateChosen() : texts.publicChosen(userInfo.username);
					}

					if (post_publicly === null)
						return device.sendMessageToDevice(from_address, 'text', (response ? response + '\n\n' : '') + texts.privateOrPublic());

					let challenge = userInfo.username + ' ' + userInfo.user_address;
					if (text === 'again') {
						let link = api.getLoginURL(userInfo.unique_id);
						return device.sendMessageToDevice( from_address, 'text', (response ? response + '\n\n' : '') + texts.proveUsername(link) );
					}

					// handle signed message
					let arrSignedMessageMatches = text.match(/\(signed-message:(.+?)\)/);
					if (arrSignedMessageMatches){
						let signedMessageBase64 = arrSignedMessageMatches[1];
						var validation = require('byteballcore/validation.js');
						var signedMessageJson = Buffer(signedMessageBase64, 'base64').toString('utf8');
						console.error(signedMessageJson);
						try{
							var objSignedMessage = JSON.parse(signedMessageJson);
						}
						catch(e){
							return null;
						}
						validation.validateSignedMessage(objSignedMessage, err => {
							if (err)
								return device.sendMessageToDevice(from_address, 'text', err);
							if (objSignedMessage.signed_message !== challenge)
								return device.sendMessageToDevice(from_address, 'text', "You signed a wrong message: "+objSignedMessage.signed_message+", expected: "+challenge);
							if (objSignedMessage.authors[0].address !== userInfo.user_address)
								return device.sendMessageToDevice(from_address, 'text', "You signed the message with a wrong address: "+objSignedMessage.authors[0].address+", expected: "+userInfo.user_address);
							db.query(
								"SELECT 1 FROM signed_messages WHERE user_address=? AND creation_date>"+db.addTime('-1 DAY'), 
								[userInfo.user_address],
								rows => {
									if (rows.length > 0)
										return device.sendMessageToDevice(from_address, 'text', "You are already attested.");
									db.query(
										`INSERT INTO transactions (receiving_address, proof_type) VALUES (?, 'signature')`, 
										[receiving_address],
										(res) => {
											let transaction_id = res.insertId;
											db.query(
												`INSERT INTO signed_messages (transaction_id, user_address, signed_message) VALUES (?,?,?)`,
												[transaction_id, userInfo.user_address, signedMessageJson],
												() => {
													db.query(
														`SELECT device_address, user_address, username, reputation, is_eligible, post_publicly
														FROM receiving_addresses WHERE receiving_address=?`,
														[receiving_address],
														rows => {
															let row = rows[0];
															if (!row)
																throw Error("no receiving address "+receiving_address);
															row.transaction_id = transaction_id;
															attest(row, 'signature');
														}
													);
												}
											);
										}
									);
								}
							);
						});
						return;
					}
					
					db.query(
						`SELECT transaction_id, is_confirmed, received_amount, user_address, username, attestation_date
						FROM accepted_payments
						JOIN receiving_addresses USING(receiving_address)
						LEFT JOIN attestation_units USING(transaction_id)
						WHERE receiving_address=?
						ORDER BY transaction_id DESC
						LIMIT 1`,
						[receiving_address],
						(rows) => {
							/**
							 * if user didn't pay yet
							 */
							if (rows.length === 0) {
								return device.sendMessageToDevice(
									from_address,
									'text',
									(response ? response + '\n\n' : '') + 
										texts.pleasePayOrPrivacy(receiving_address, price, challenge, post_publicly)
								);
							}

							let row = rows[0];
							let transaction_id = row.transaction_id;

							/**
							 * if user paid, but transaction did not become stable
							 */
							if (row.is_confirmed === 0) {
								return device.sendMessageToDevice(
									from_address,
									'text',
									(response ? response + '\n\n' : '') + texts.receivedYourPayment(row.received_amount)
								);
							}

							if (text === 'private' || text === 'public')
								return device.sendMessageToDevice(from_address, 'text', response);
							
							device.sendMessageToDevice(from_address, 'text', (response ? response + '\n\n' : '') + texts.alreadyAttested(row.attestation_date));
						}
					);

				});
			});
		});
	});
}


/**
 * get user's information by device address
 * or create new user, if it's new device address
 * @param device_address
 * @param callback
 */
function readUserInfo(device_address, callback) {
	db.query(
		`SELECT users.user_address, receiving_addresses.username, unique_id, users.device_address 
		FROM users LEFT JOIN receiving_addresses USING(device_address, user_address) 
		WHERE device_address = ?`,
		[device_address],
		(rows) => {
			if (rows.length) {
				callback(rows[0]);
			}
			else {
				let unique_id = crypto.randomBytes(24).toString("base64");
				db.query(`INSERT ${db.getIgnore()} INTO users (device_address, unique_id) VALUES(?,?)`, [device_address, unique_id], () => {
					callback({unique_id, device_address});
				});
			}
		}
	);
}

/**
 * read or assign receiving address
 * @param device_address
 * @param userInfo
 * @param callback
 */
function readOrAssignReceivingAddress(userInfo, callback) {
	const mutex = require('byteballcore/mutex.js');
	mutex.lock([userInfo.device_address], (unlock) => {
		db.query(
			`SELECT receiving_address, post_publicly, ${db.getUnixTimestamp('last_price_date')} AS price_ts
			FROM receiving_addresses 
			WHERE device_address=? AND user_address=? AND username=?`,
			[userInfo.device_address, userInfo.user_address, userInfo.username],
			(rows) => {
				if (rows.length > 0) {
					let row = rows[0];
					callback(row.receiving_address, row.post_publicly);
					return unlock();
				}

				const headlessWallet = require('headless-byteball');
				headlessWallet.issueNextMainAddress((receiving_address) => {
					db.query(
						`INSERT INTO receiving_addresses 
						(device_address, user_address, username, receiving_address, price, last_price_date) 
						VALUES(?,?,?, ?, ?,${db.getNow()})`,
						[userInfo.device_address, userInfo.user_address, userInfo.username, receiving_address, conf.priceInBytes],
						() => {
							callback(receiving_address, null);
							unlock();
						}
					);
				});
			}
		);
	});
}

function getRewardInUSDByReputation(reputation) {
	let reward = 0;
	conf.arrReputationRewardsInUsd.forEach((row) => {
		if (reputation >= row.threshold && reward < row.rewardInUsd)
			reward = row.rewardInUsd;
	});
	return reward;
}

process.on('unhandledRejection', up => { throw up; });
