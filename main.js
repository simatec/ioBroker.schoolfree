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
            adapter.log.debug('cleaned everything up...');
            callback();
        } catch (e) {
            callback();
        }
    });

    // is called if a subscribed object changes
    adapter.on('objectChange', (id, obj) => {
        if (obj) {
            // The object was changed
            adapter.log.debug(`object ${id} changed: ${JSON.stringify(obj)}`);
        } else {
            // The object was deleted
            adapter.log.debug(`object ${id} deleted`);
        }
    });

    // is called if a subscribed state changes
    adapter.on('stateChange', (id, state) => {
        if (state) {
            // The state was changed
            adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            adapter.log.debug(`state ${id} deleted`);
        }
    });
}
function checkState() {

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
            if (content) {
                const federalStateStr = adapter.config.federalState
                const arr1 = content.data.filter(d => d.federal_state_id == federalStateStr);
                const arrStart = arr1.filter(d => d.starts_on >= today);
                const arr2 = arrStart.filter(d => d.ends_on >= today);
        
                const res = arr2.map(({ starts_on, ends_on, name }) => ({ starts_on, ends_on, name }));
                
                adapter.setState('info.schoolfreeToday', { val: false, ack: true });
                adapter.setState('info.schoolfreeTomorow', { val: false, ack: true });
                adapter.setState('info.schoolfreeStart', { val: 'none', ack: true });
                adapter.setState('info.schoolfreeEnd', { val: 'none', ack: true });
                adapter.setState('info.schoolfreeName', { val: 'none', ack: true });

                //today = '2019-05-31';
                //tomorow = '2019-06-01'
        
                for (let i of res) {
                    let result = Object.keys(i).map(key => i[key])
                    let result2 = ('' + result)
                    let result3 = result2.split(',')
                    if (result3[0] <= today && result3[1] >= today) {
                        adapter.log.debug('school free name: ' + result3[2])
                        adapter.log.debug('school free today')
                        adapter.setState('info.schoolfreeToday', { val: true, ack: true });
                        adapter.setState('info.schoolfreeStart', { val: result3[0], ack: true });
                        adapter.setState('info.schoolfreeEnd', { val: result3[1], ack: true });
                        adapter.setState('info.schoolfreeName', { val: result3[2], ack: true });
                        adapter.log.debug('string: ' + result)
                    }
                    if (result3[0] <= tomorow && result3[1] >= tomorow) {
                        adapter.log.debug('school free name: ' + result3[2])
                        adapter.log.debug('school free tomorow')
                        adapter.setState('info.schoolfreeTomorow', { val: true, ack: true });
                        adapter.setState('info.schoolfreeStart', { val: result3[0], ack: true });
                        adapter.setState('info.schoolfreeEnd', { val: result3[1], ack: true });
                        adapter.setState('info.schoolfreeName', { val: result3[2], ack: true });
                        adapter.log.debug('string: ' + result)
                    }
                    //result.push(Object.keys(i).map(key => i[key]))
                    //adapter.log.warn("key is: " + Object.keys(i));
                    //adapter.log.warn("value is: " + Object.keys(i).map(key => i[key])) // Object.values can be used as well in newer versions.
                }
                adapter.log.debug('Request done');
            } else if (error) {
                adapter.log.warn('Request error');
            }
        });
}
function main() {

    checkState();

    // in this template all states changes inside are subscribed
    adapter.subscribeStates('*');
    setTimeout(function () {
        adapter.stop();
    }, 10000);
}
// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}