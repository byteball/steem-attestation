/*jslint node: true */
"use strict";
var async = require('async');
var db = require('byteballcore/db.js');
var eventBus = require('byteballcore/event_bus.js');
var headlessWallet = require('headless-byteball');

/*
const announcement = `Dear Steemians!

Byteball is thrilled to be featured in Binance's monthly community coin vote.
If you have an account on Binance, please vote to support the Byteball platform https://www.binance.com/vote.html

Being listed on Binance helps attract attention to projects. It might potentially benefit you and the value of the Bytes you have on smart contracts. The deadline to vote is August 31. We currently have around 160 votes and your vote is really important. 

Thank you Steemians!

Team Byteball

https://www.binance.com/vote.html
`;
*/
//const announcement = "Byteball contest with 22 GB in prizes ends 30 September. You can still enter. Only 7 people with entries so far. Hurry! See https://goo.gl/33M5za";

const announcement = "We are extremely pleased to announce our first decentralized witness candidate. This is a major milestone for Byteball. Read the full article here: https://medium.com/byteball/first-decentralized-witness-candidate-rogier-eijkelhof-9e5619166334";

//const optout_text = "\n\nIf you don't want to receive news here, [click here to opt out](command:optout).";
const message = announcement;// + optout_text;

headlessWallet.setupChatEventHandlers();

function sendAnnouncement(){
	var device = require('byteballcore/device.js');
	db.query(
		"SELECT device_address FROM users",
		rows => {
			console.error(rows.length+" messages will be sent");
			async.eachSeries(
				rows,
				(row, cb) => {
					device.sendMessageToDevice(row.device_address, 'text', message, {
						ifOk: function(){}, 
						ifError: function(){}, 
						onSaved: function(){
							console.log("sent to "+row.device_address);
							cb();
						}
					});
				},
				() => {
					console.error("=== done");
				}
			);
		}
	);
}

eventBus.on('text', function(from_address, text){
	var device = require('byteballcore/device.js');
	console.log('text from '+from_address+': '+text);
	text = text.trim().toLowerCase();
	/*if (text === 'optout'){
		db.query("INSERT "+db.getIgnore()+" INTO optouts (device_address) VALUES(?)", [from_address]);
		return device.sendMessageToDevice(from_address, 'text', 'You are unsubscribed from future announcements.');
	}
	else */if (text.match(/thank/))
		device.sendMessageToDevice(from_address, 'text', "You're welcome!");
	else
		device.sendMessageToDevice(from_address, 'text', "Usual operations are paused while sending announcements.  Check again in a few minutes.");
});

eventBus.on('headless_wallet_ready', () => {
	setTimeout(sendAnnouncement, 1000);
});

