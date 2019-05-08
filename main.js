'use strict';

const utils = require('@iobroker/adapter-core');
const request = require('request');

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;
const adapterName = require('./package.json').name.split('.').pop();

/**
 * Starts the adapter instance
 * @param {Partial<ioBroker.AdapterOptions>} [options]
 */
function startAdapter(options) {

    options = options || {};
    Object.assign(options, {name: adapterName});

    adapter = new utils.Adapter(options);
 
    // start here!
    adapter.on('ready', main); // Main method defined below for readability

    // is called when adapter shuts down - callback has to be called under any circumstances!
    adapter.on('unload', (callback) => {
        try {
            adapter.log.info('cleaned everything up...');
            callback();
        } catch (e) {
            callback();
        }
    });

    // is called if a subscribed object changes
    adapter.on('objectChange', (id, obj) => {
        if (obj) {
            // The object was changed
            adapter.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
            //shutterDriveCalc();
        } else {
            // The object was deleted
            adapter.log.info(`object ${id} deleted`);
        }
    });

    // is called if a subscribed state changes
    adapter.on('stateChange', (id, state) => {
        if (state) {
            // The state was changed
            adapter.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            adapter.log.info(`state ${id} deleted`);
        }
    });
}
function checkState(){
    let date = new Date();
    let monthIndex = (date.getMonth() +1);
    let year = date.getFullYear();
    let day = date.getDate();
    let today = (year + '-' + ('0' + monthIndex).slice(-2) + '-' + ('0' + day).slice(-2));
    
    let dateTomorow = new Date(date.getTime() + (1000 * 60 * 60 * 24 * 1));
    let monthIndexTomorow = (dateTomorow.getMonth() +1);
    let yearTomorow = dateTomorow.getFullYear();
    let dayTomorow = dateTomorow.getDate();
    let tomorow = (yearTomorow + '-' + ('0' + monthIndexTomorow).slice(-2) + '-' + ('0' + dayTomorow).slice(-2));

    request(
        {
            url: 'https://www.mehr-schulferien.de/api/v1.0/periods',
            json: true
        },
        function (error, response, content) {
    
            const arr1 = content.data.filter(d => d.federal_state_id === 14);
            const arrStart = arr1.filter(d => d.starts_on >= today);
            const arr2 = arrStart.filter(d => d.ends_on >= today);
    
            const res = arr2.map(({ starts_on, ends_on, name }) => ({ starts_on, ends_on, name }));
    
            let ferienToday = false
            let ferienTomorow = false
    
            for (let i of res) {
                let testStr = Object.keys(i).map(key => i[key])
                let test2 = ('' + testStr)
                let test3 = test2.split(',')
                if (test3[0] <= today && test3[1] >= today) {
                    adapter.log.warn(test3[2])
                    adapter.log.warn('Ferien heute')
                    ferienToday = true
                    adapter.log.warn(testStr)
                }
                if (test3[0] <= tomorow && test3[1] >= tomorow) {
                    adapter.log.warn(test3[2])
                    adapter.log.warn('Ferien morgen')
                    ferienTomorow = true
                    adapter.log.warn(testStr)
                }
                //result.push(Object.keys(i).map(key => i[key]))
                //adapter.log.warn("key is: " + Object.keys(i));
                //adapter.log.warn("value is: " + Object.keys(i).map(key => i[key])) // Object.values can be used as well in newer versions.
            }
            adapter.log.warn(ferienToday);
            adapter.log.warn('Request done');
            /*
            let result = []
            for(let i of res){
                result.push(Object.keys(i).map(key => i[key]))
                adapter.log.warn("key is: " + Object.keys(i));
                adapter.log.warn("value is: " + Object.keys(i).map(key => i[key])) // Object.values can be used as well in newer versions.
            }
            adapter.log.warn(result)
            */
    
        });
}
function main() {

    checkState();

    // in this template all states changes inside are subscribed
    adapter.subscribeStates('*');
}
// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}