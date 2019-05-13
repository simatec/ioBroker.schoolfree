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
                const federalStateStr = adapter.config.federalState;
                // Filter current federal State
                const arr1 = content.data.filter(d => d.federal_state_id == federalStateStr);
                // Filter old holidays
                const arr2 = arr1.filter(d => d.ends_on >= today);
                // Filter Long weekends
                const arr3 = arr2.filter(d => d.starts_on != d.ends_on);
                // Filter Data
                const res = arr3.map(({ starts_on, ends_on, name }) => ({ starts_on, ends_on, name }));
                // sort for start holiday
                const res2 = res.sort((a, b) => (a.starts_on > b.starts_on) ? 1 : -1);
                if (res2[0].starts_on && res2[0].ends_on && res2[0].name) {
                    if (res2[0].starts_on <= today && res2[0].ends_on >= today) {
                        adapter.log.debug('school free name: ' + res2[0].name);
                        adapter.log.debug('school free today');
                        adapter.setState('info.schoolfreeToday', { val: true, ack: true });
                        adapter.setState('info.schoolfreeStart', { val: res2[0].starts_on, ack: true });
                        adapter.setState('info.schoolfreeEnd', { val: res2[0].ends_on, ack: true });
                        adapter.setState('info.schoolfreeName', { val: res2[0].name, ack: true });
                        adapter.log.debug('string: ' + JSON.stringify(res2[0]));
                    } else {
                        adapter.setState('info.schoolfreeToday', { val: false, ack: true });
                    }
                    if (res2[0].starts_on <= tomorow && res2[0].ends_on >= tomorow) {
                        adapter.log.debug('school free name: ' + res2[0].name)
                        adapter.log.debug('school free tomorow')
                        adapter.setState('info.schoolfreeTomorow', { val: true, ack: true });
                        adapter.setState('info.schoolfreeStart', { val: res2[0].starts_on, ack: true });
                        adapter.setState('info.schoolfreeEnd', { val: res2[0].ends_on, ack: true });
                        adapter.setState('info.schoolfreeName', { val: res2[0].name, ack: true });
                        adapter.log.debug('string: ' + JSON.stringify(res2[0]));
                    } else {
                        adapter.setState('info.schoolfreeTomorow', { val: false, ack: true });
                    }
                    if (res2[0].starts_on > today && res2[0].starts_on > tomorow) {
                        adapter.setState('info.schoolfreeStart', { val: 'none', ack: true });
                        adapter.setState('info.schoolfreeEnd', { val: 'none', ack: true });
                        adapter.setState('info.schoolfreeName', { val: 'none', ack: true });
                    }
                    if (res2[0].starts_on > today) {
                        adapter.setState('info.schoolfreeNextStart', { val: res2[0].starts_on, ack: true });
                        adapter.setState('info.schoolfreeNextEnd', { val: res2[0].ends_on, ack: true });
                        adapter.setState('info.schoolfreeNextName', { val: res2[0].name, ack: true });
                    } else if (res2[0].starts_on <= today && res2[0].ends_on >= today) {
                        adapter.setState('info.schoolfreeNextStart', { val: res2[1].starts_on, ack: true });
                        adapter.setState('info.schoolfreeNextEnd', { val: res2[1].ends_on, ack: true });
                        adapter.setState('info.schoolfreeNextName', { val: res2[1].name, ack: true });
                    }
                }
                adapter.log.debug('Request done');
            } else if (error) {
                adapter.log.warn('Request error');
            }
        });
}
function main() {

    checkState();

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