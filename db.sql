CREATE TABLE users (
	device_address CHAR(33) NOT NULL PRIMARY KEY,
	unique_id CHAR(32) NOT NULL UNIQUE,
	user_address CHAR(32) NULL,
	username VARCHAR(64) NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address)
);

CREATE TABLE receiving_addresses (
	receiving_address CHAR(32) NOT NULL PRIMARY KEY,
	device_address CHAR(33) NOT NULL,
	user_address CHAR(32) NOT NULL,
	username VARCHAR(64) NOT NULL,
	reputation INT NULL,
	is_eligible TINYINT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	post_publicly TINYINT NULL,
	price INT NULL,
	last_price_date TIMESTAMP NULL,
	UNIQUE (device_address, user_address, username),
	FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address),
	FOREIGN KEY (receiving_address) REFERENCES my_addresses(address)
);
CREATE INDEX byReceivingAddress ON receiving_addresses(receiving_address);
CREATE INDEX ra_byUserAddress ON receiving_addresses(user_address);
CREATE INDEX byUsername ON receiving_addresses(username);

CREATE TABLE transactions (
	transaction_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	receiving_address CHAR(32) NOT NULL,
	proof_type VARCHAR(10) CHECK (proof_type IN('payment', 'signature')) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (receiving_address) REFERENCES receiving_addresses(receiving_address)
);

CREATE TABLE accepted_payments (
	transaction_id INTEGER NOT NULL PRIMARY KEY,
	receiving_address CHAR(32) NOT NULL,
	price INT NOT NULL,
	received_amount INT NOT NULL,
	payment_unit CHAR(44) NOT NULL UNIQUE,
	payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	is_confirmed INT NOT NULL DEFAULT 0,
	confirmation_date TIMESTAMP NULL,
	FOREIGN KEY (receiving_address) REFERENCES receiving_addresses(receiving_address),
	FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id)
--	FOREIGN KEY (payment_unit) REFERENCES units(unit) ON DELETE CASCADE
);

CREATE TABLE rejected_payments (
	rejected_payment_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	receiving_address CHAR(32) NOT NULL,
	price INT NOT NULL,
	received_amount INT NOT NULL,
	payment_unit CHAR(44) NOT NULL UNIQUE,
	payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	error TEXT NOT NULL,
	FOREIGN KEY (receiving_address) REFERENCES receiving_addresses(receiving_address)
--	FOREIGN KEY (payment_unit) REFERENCES units(unit) ON DELETE CASCADE
);

CREATE TABLE signed_messages (
	transaction_id INTEGER NOT NULL PRIMARY KEY,
	user_address CHAR(32) NOT NULL,
	signed_message TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id)
);
CREATE INDEX sm_byUserAddress ON signed_messages(user_address);


CREATE TABLE attestation_units (
	transaction_id INTEGER NOT NULL,
	attestation_unit CHAR(44) NULL UNIQUE,
	attestation_date TIMESTAMP NULL,
	PRIMARY KEY (transaction_id),
	FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id),
	FOREIGN KEY (attestation_unit) REFERENCES units(unit)
);

CREATE TABLE contracts (
	user_address CHAR(32) NOT NULL PRIMARY KEY,
	contract_address CHAR(32) NOT NULL UNIQUE,
	contract_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	contract_vesting_date TIMESTAMP NOT NULL,
	FOREIGN KEY (contract_address) REFERENCES shared_addresses(shared_address)
);

CREATE TABLE link_referrals (
	referring_user_address CHAR(32) NOT NULL, -- must be attested
	device_address CHAR(33) NOT NULL,
	type VARCHAR(10) NOT NULL, -- pairing, cookie
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (device_address, referring_user_address, type),
	FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address)
);

CREATE TABLE reward_units (
	transaction_id INTEGER NOT NULL PRIMARY KEY,
	device_address CHAR(33) NOT NULL UNIQUE,
	user_address CHAR(32) NOT NULL UNIQUE,
	username VARCHAR(64) NOT NULL UNIQUE,
	user_id CHAR(44) NOT NULL UNIQUE,
	reward INT NOT NULL,
	contract_reward INT NOT NULL,
	reward_unit CHAR(44) NULL UNIQUE,
	reward_date TIMESTAMP NULL,
	FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id),
	FOREIGN KEY (reward_unit) REFERENCES units(unit)
);

CREATE TABLE referral_reward_units (
	transaction_id INTEGER NOT NULL PRIMARY KEY,
	user_address CHAR(32) NOT NULL,
	user_id CHAR(44) NOT NULL,
	new_user_id CHAR(44) NOT NULL UNIQUE,
	new_user_address CHAR(44) NOT NULL UNIQUE,
	reward INT NOT NULL,
	contract_reward INT NOT NULL,
	reward_unit CHAR(44) NULL UNIQUE,
	reward_date TIMESTAMP NULL,
	FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id),
	FOREIGN KEY (new_user_id) REFERENCES reward_units(user_id),
	FOREIGN KEY (reward_unit) REFERENCES units(unit)
);

/*
ALTER TABLE receiving_addresses ADD COLUMN is_eligible TINYINT NULL;
*/
