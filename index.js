"use strict";
// trigger the debugger so that you can easily set breakpoints
//debugger;

var VectorWatch = require('vectorwatch-sdk');
var StorageProvider = require('vectorwatch-storageprovider');
var Schedule = require('node-schedule');
var request = require('request');


var vectorWatch = new VectorWatch();
var logger = vectorWatch.logger;
var storageProvider = new StorageProvider();

vectorWatch.setStorageProvider(storageProvider);

function run_query(machine, user, password) {
    var limit = 10;
    var url = 'https://' + machine + "/api/now/table/sysapproval_approver?sysparm_exclude_reference_link=true&sysparm_fields=state%2Cdue_date&sysparm_limit=" + limit;

    return new Promise(function(resolve, reject) {
        request.get({
                'uri': url,
                'auth': {
                    'user': user,
                    'pass': password
                }
            },
            function(error, httpResponse, body) {
                if (error) {
                    logger.error('REST call error: ' + error.message + ' for ' + url);
                    reject('REST call error: ' + error.message + ' for ' + url);
                    return;
                }

                if (httpResponse && httpResponse.statusCode != 200) {
                    logger.error('REST call error: ' + httpResponse.statusCode + ' for ' + url);
                    reject('REST call error: ' + httpResponse.statusCode + ' for ' + url);
                    return;
                }

                try {
                    body = JSON.parse(body);
                    resolve(body);
                } catch (err) {
                    logger.error('Malformed JSON response from ' + url + ': ' + err.message);
                    reject('Malformed JSON response from ' + url + ': ' + err.message);
                }

            });
    });
}

vectorWatch.on('config', function(event, response) {
    // your stream was just dragged onto a watch face
    logger.info('on config');
    var machine = response.createAutocomplete('machine');
    machine.setHint('ServiceNow instance (excluding https://)');
    machine.setDynamic(true);
    machine.setAsYouType(1);

    var user = response.createAutocomplete('user');
    user.setHint('User name for ServiceNow instance');
    user.setDynamic(true);
    user.setAsYouType(1);

    var password = response.createAutocomplete('password');
    password.setHint('Password for ServicceNow instance');
    password.setDynamic(true);
    password.setAsYouType(1);

    response.send();
});

vectorWatch.on('options', function(event, response) {
    // dynamic options for a specific setting name was requested
    var settingName = event.getSettingName();
    var searchTerm = event.getSearchTerm();

    switch (settingName) {
        case 'machine':
        case 'user':
        case 'password':
            response.addOption(searchTerm.substring(0, 60));
            response.send();
            break;
        default:
            logger.error("Invalid setting name: " + settingName);
            response.addOption('APPLICATION ERROR');
            response.send();
    }
});

function getStreamText(resp) {
    return 'A: ' + resp.length;
    /** result example
{
  "result": [
    {
      "due_date": "2016-11-22 12:43:39",
      "state": "approved"
    }
  ]
}
**/

}

vectorWatch.on('subscribe', function(event, response) {
    // your stream was added to a watch face
    logger.info('on subscribe');

    var machine;
    var user;
    var password;

    //get configuration option
    try {
        machine = event.getUserSettings().settings['machine'].name;
        user = event.getUserSettings().settings['user'].name;
        password = event.getUserSettings().settings['password'].name;
    } catch (err) {
        logger.error('on subscribe - malformed user setting: ' + err.message);
        response.setValue('SERVER ERROR');
        response.send();
    }

    //run first query
    try {
        run_query(machine, user, password).then(function(body) {
            var res = (getStreamText(body.result));
            response.setValue(res);
            response.send();
        }).catch(function(e) {
            logger.error(e);
            response.setValue('AUTH ERROR');
            response.send();
        });
    } catch (err) {
        logger.error('invalid response from ServiceNow instance: ' + machine);
        response.setValue('RESPONSE ERROR');
        response.send();
    }
});

vectorWatch.on('unsubscribe', function(event, response) {
    // your stream was removed from a watch face
    logger.info('on unsubscribe');
    response.send();
});

function pushUpdates() {
    storageProvider.getAllUserSettingsAsync().then(function(records) {
        records.forEach(function(record) {
            var settings = record.userSettings;
            try {
                run_query(settings.machine.name, settings.user.name, settings.password.name).then(function(body) {
                    var streamText = getStreamText(body.query.results.rate.Rate);
                    vectorWatch.pushStreamValue(record.channelLabel, streamText);
                }).catch(function(e) {
                    logger.error(e);
                });
            } catch (err) {
                logger.error('on push - malformed user setting: ' + err.message);
            }
        });
    });
}

function scheduleJob() {
    var scheduleRule = new Schedule.RecurrenceRule();
    scheduleRule.minute = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 0];
    Schedule.scheduleJob(scheduleRule, pushUpdates);
}

vectorWatch.createServer(scheduleJob);
