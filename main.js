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

    // calc current date
    let date = new Date();
    let monthIndex = (date.getMonth() +1);
    let year = date.getFullYear();
    let day = date.getDate();
    let today = (year + '-' + ('0' + monthIndex).slice(-2) + '-' + ('0' + day).slice(-2));

    // calc Tomorrow date
    let dateTomorrow = new Date(date.getTime() + (1000 * 60 * 60 * 24 * 1));
    let monthIndexTomorrow = (dateTomorrow.getMonth() +1);
    let yearTomorrow = dateTomorrow.getFullYear();
    let dayTomorrow = dateTomorrow.getDate();
    let Tomorrow = (yearTomorrow + '-' + ('0' + monthIndexTomorrow).slice(-2) + '-' + ('0' + dayTomorrow).slice(-2));

    // request API from www.mehr-schulferien.de
    request(
        {
            url: 'https://www.mehr-schulferien.de/api/v1.0/periods',
            json: true
        },

        function (error, response, content) {

            if (content) {
                const federalStateStr = adapter.config.federalState;
                // Filter current federal State
                const arrFederalState = content.data.filter(d => d.federal_state_id == federalStateStr);
                // Filter old holidays
                const arrNewHoliday = arrFederalState.filter(d => d.ends_on >= today);
                // Filter Long weekends
                const arrOnlyholiday = arrNewHoliday.filter(d => d.starts_on != d.ends_on);
                // Filter Data
                const resData = arrOnlyholiday.map(({ starts_on, ends_on, name }) => ({ starts_on, ends_on, name }));
                // sort for start holiday
                const result = resData.sort((a, b) => (a.starts_on > b.starts_on) ? 1 : -1);

                if (result[0] && result[0].starts_on !== 'undefined') {
                    // Set schoolfree today
                    let currentStart;
                    let currentEnd;

                    currentStart = result[0].starts_on.split('-');
                    currentStart = (currentStart[2] + '.' + currentStart[1] + '.' + currentStart[0]);
                    currentEnd = result[0].ends_on.split('-');
                    currentEnd = (currentEnd[2] + '.' + currentEnd[1] + '.' + currentEnd[0]);

                    if (result[0].starts_on <= today && result[0].ends_on >= today) {
                        adapter.log.debug('school free name: ' + result[0].name);
                        adapter.log.debug('school free today');
                        adapter.setState('info.today', { val: true, ack: true });
                        adapter.setState('info.current.start', { val: currentStart, ack: true });
                        adapter.setState('info.current.end', { val: currentEnd, ack: true });
                        adapter.setState('info.current.name', { val: result[0].name, ack: true });
                        adapter.log.debug('string: ' + JSON.stringify(result[0]));
                    } else {
                        adapter.setState('info.today', { val: false, ack: true });
                    }
                    // Set schoolfree tomorrow
                    if (result[0].starts_on <= Tomorrow && result[0].ends_on >= Tomorrow) {
                        adapter.log.debug('school free name: ' + result[0].name)
                        adapter.log.debug('school free tomorrow')
                        adapter.setState('info.tomorrow', { val: true, ack: true });
                        adapter.setState('info.current.start', { val: currentStart, ack: true });
                        adapter.setState('info.current.end', { val: currentEnd, ack: true });
                        adapter.setState('info.current.name', { val: result[0].name, ack: true });
                        adapter.log.debug('string: ' + JSON.stringify(result[0]));
                    } else {
                        adapter.setState('info.tomorrow', { val: false, ack: true });
                    }
                    // clear schoolfree after holiday
                    if (result[0].starts_on > today && result[0].starts_on > Tomorrow) {
                        adapter.setState('info.current.start', { val: 'none', ack: true });
                        adapter.setState('info.current.end', { val: 'none', ack: true });
                        adapter.setState('info.current.name', { val: 'none', ack: true });
                    }
                    // Set next holiday
                    let nextStart;
                    let nextEnd;

                    if (result[0].starts_on > today) {
                        nextStart = result[0].starts_on.split('-');
                        nextStart = (nextStart[2] + '.' + nextStart[1] + '.' + nextStart[0]);
                        nextEnd = result[0].ends_on.split('-');
                        nextEnd = (nextEnd[2] + '.' + nextEnd[1] + '.' + nextEnd[0]);

                        adapter.setState('info.next.start', { val: nextStart, ack: true });
                        adapter.setState('info.next.end', { val: nextEnd, ack: true });
                        adapter.setState('info.next.name', { val: result[0].name, ack: true });
                    } else if (result[0].starts_on <= today && result[0].ends_on >= today) {
                        nextStart = result[1].starts_on.split('-');
                        nextStart = (nextStart[2] + '.' + nextStart[1] + '.' + nextStart[0]);
                        nextEnd = result[1].ends_on.split('-');
                        nextEnd = (nextEnd[2] + '.' + nextEnd[1] + '.' + nextEnd[0]);

                        adapter.setState('info.next.start', { val: nextStart, ack: true });
                        adapter.setState('info.next.end', { val: nextEnd, ack: true });
                        adapter.setState('info.next.name', { val: result[1].name, ack: true });
                    }
                    adapter.log.info('schoolfree request done');
                }
            } else if (error) {
                adapter.log.warn('schoolfree request error');
            }
        });
}
function main() {
    // function for request
    checkState();
    
    // Adapter stop after 10 Seconds
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