'use strict';

const utils = require('@iobroker/adapter-core');
const request = require('request');
const fs = require('fs');

/** @type {number | undefined} */
let timerRequest;
/** @type {number | undefined} */
let timerError;

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
    Object.assign(options, { name: adapterName });

    adapter = new utils.Adapter(options);

    // start here!
    adapter.on('ready', main); // Main method defined below for readability

    // is called when adapter shuts down - callback has to be called under any circumstances!
    adapter.on('unload', (callback) => {
        try {
            adapter.log.debug('cleaned everything up...');
            clearTimeout(timerRequest);
            clearTimeout(timerError);
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
function checkHolidayNames() {
    try {
        request(
            {
                url: 'https://www.mehr-schulferien.de/api/v2.0/holiday_or_vacation_types',
                json: true
            },

            function (error, response, content) {

                checkState(content.data);
            });
    } catch (e) {
        adapter.log.warn('schoolfree request error');
        adapter.log.warn(e);
        timerError = setTimeout(function () {
            adapter.stop();
        }, 5000);
    }
}

function checkState(holidayNames) {

    // calc current date
    let date = new Date();
    let monthIndex = (date.getMonth() + 1);
    let year = date.getFullYear();
    let day = date.getDate();
    let today = (year + '-' + ('0' + monthIndex).slice(-2) + '-' + ('0' + day).slice(-2));

    // calc Tomorrow date
    let dateTomorrow = new Date(date.getTime() + (1000 * 60 * 60 * 24 * 1));
    let monthIndexTomorrow = (dateTomorrow.getMonth() + 1);
    let yearTomorrow = dateTomorrow.getFullYear();
    let dayTomorrow = dateTomorrow.getDate();
    let Tomorrow = (yearTomorrow + '-' + ('0' + monthIndexTomorrow).slice(-2) + '-' + ('0' + dayTomorrow).slice(-2));

    // request API from www.mehr-schulferien.de
    try {
        request(
            {
                url: 'https://www.mehr-schulferien.de/api/v2.0/periods',
                json: true
            },

            function (error, response, content) {

                let federalStateStr = 0;
                let searchLocation = content.data.filter(d => d.location_id == adapter.config.schools);
                if (JSON.stringify(searchLocation) !== '[]') {
                    federalStateStr = adapter.config.schools;
                } else {
                    searchLocation = content.data.filter(d => d.location_id == adapter.config.places);
                    if (JSON.stringify(searchLocation) !== '[]') {
                        federalStateStr = adapter.config.places;
                    } else {
                        searchLocation = content.data.filter(d => d.location_id == adapter.config.counties);
                        if (JSON.stringify(searchLocation) !== '[]') {
                            federalStateStr = adapter.config.counties;
                        } else {
                            federalStateStr = adapter.config.federalState;
                        }
                    }
                }

                //federalStateStr = adapter.config.federalState;
                // Filter current federal State
                const arrFederalState = content.data.filter(d => d.location_id == federalStateStr);
                // Filter old holidays
                const arrNewHoliday = arrFederalState.filter(d => d.ends_on >= today);

                let arrOnlyholiday;
                let resData;
                if (adapter.config.ignorePublicHoliday) {
                    adapter.log.debug('ignore public holiday');
                    // Filter Long weekends
                    arrOnlyholiday = arrNewHoliday.filter(d => d.starts_on != d.ends_on);
                    // Filter Data
                    resData = arrOnlyholiday.map(({ starts_on, ends_on, holiday_or_vacation_type_id }) => ({ starts_on, ends_on, holiday_or_vacation_type_id }));
                } else {
                    resData = arrNewHoliday.map(({ starts_on, ends_on, holiday_or_vacation_type_id }) => ({ starts_on, ends_on, holiday_or_vacation_type_id }));
                }
                // sort for start holiday
                const result = resData.sort((a, b) => (a.starts_on > b.starts_on) ? 1 : -1);
                let currentName = holidayNames.filter(d => d.id == result[0].holiday_or_vacation_type_id);
                let nextName = holidayNames.filter(d => d.id == result[1].holiday_or_vacation_type_id);

                if (result[0] && result[0].starts_on !== 'undefined') {
                    // Set schoolfree today
                    let currentStart;
                    let currentEnd;

                    currentStart = result[0].starts_on.split('-');
                    currentStart = (currentStart[2] + '.' + currentStart[1] + '.' + currentStart[0]);
                    currentEnd = result[0].ends_on.split('-');
                    currentEnd = (currentEnd[2] + '.' + currentEnd[1] + '.' + currentEnd[0]);

                    if (result[0].starts_on <= today && result[0].ends_on >= today) {
                        adapter.log.debug(`school free name: ${currentName[0].colloquial ? currentName[0].colloquial : currentName[0].name}`);
                        adapter.log.debug('school free today');

                        adapter.setState('info.today', { val: true, ack: true });
                        adapter.setState('info.current.start', { val: currentStart, ack: true });
                        adapter.setState('info.current.end', { val: currentEnd, ack: true });
                        adapter.setState('info.current.name', { val: currentName[0].colloquial ? currentName[0].colloquial : currentName[0].name, ack: true });

                        adapter.log.debug('string: ' + JSON.stringify(result[0]));
                    } else {
                        adapter.setState('info.today', { val: false, ack: true });
                    }
                    // Set schoolfree tomorrow
                    if (result[0].starts_on <= Tomorrow && result[0].ends_on >= Tomorrow) {
                        adapter.log.debug(`school free name: ${currentName[0].colloquial ? currentName[0].colloquial : currentName[0].name}`);
                        adapter.log.debug('school free tomorrow');

                        adapter.setState('info.tomorrow', { val: true, ack: true });
                        adapter.setState('info.current.start', { val: currentStart, ack: true });
                        adapter.setState('info.current.end', { val: currentEnd, ack: true });
                        adapter.setState('info.current.name', { val: currentName[0].colloquial ? currentName[0].colloquial : currentName[0].name, ack: true });

                        adapter.log.debug('string: ' + JSON.stringify(result[0]));
                    } else if (result[1].starts_on == Tomorrow) {
                        adapter.setState('info.tomorrow', { val: true, ack: true });
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
                        adapter.setState('info.next.name', { val: currentName[0].colloquial ? currentName[0].colloquial : currentName[0].name, ack: true });
                    } else if (result[0].starts_on <= today && result[0].ends_on >= today) {
                        if (result[1] && result[1].starts_on !== 'undefined') {
                            nextStart = result[1].starts_on.split('-');
                            nextStart = (nextStart[2] + '.' + nextStart[1] + '.' + nextStart[0]);
                            nextEnd = result[1].ends_on.split('-');
                            nextEnd = (nextEnd[2] + '.' + nextEnd[1] + '.' + nextEnd[0]);

                            adapter.setState('info.next.start', { val: nextStart, ack: true });
                            adapter.setState('info.next.end', { val: nextEnd, ack: true });
                            adapter.setState('info.next.name', { val: nextName[0].colloquial ? nextName[0].colloquial : nextName[0].name, ack: true });
                        } else {
                            adapter.setState('info.next.start', { val: 'No data available', ack: true });
                            adapter.setState('info.next.end', { val: 'No data available', ack: true });
                            adapter.setState('info.next.name', { val: 'No data available', ack: true });
                        }
                    }

                    adapter.log.info('schoolfree request done');
                    timerRequest = setTimeout(function () {
                        adapter.stop();
                    }, 20000);
                } else {
                    adapter.log.warn('schoolfree cannot request ...');
                    timerRequest = setTimeout(function () {
                        adapter.stop();
                    }, 20000);
                }
            });
    } catch (e) {
        adapter.log.warn('schoolfree request error');
        adapter.log.warn(e);
        timerError = setTimeout(function () {
            adapter.stop();
        }, 20000);
    }

}
function fillLocation() {
    adapter.getState('data.locations', (err, state) => {
        if (state) {
            try {
                const locations = JSON.parse(state.val);

                const arrCounties = locations.filter(d => d.id == adapter.config.counties);
                adapter.log.debug('counties number: ' + adapter.config.counties);
                if (adapter.config.counties !== 'allCounties') {
                    adapter.setState('location.countieName', { val: arrCounties[0].name ? arrCounties[0].name : 'no selection', ack: true });
                } else {
                    adapter.setState('location.countieName', { val: 'no selection', ack: true });
                }

                const arrPlaces = locations.filter(d => d.id == adapter.config.places);
                adapter.log.debug('places number: ' + adapter.config.places);
                if (adapter.config.places !== 'allPlaces') {
                    adapter.setState('location.placeName', { val: arrPlaces[0].name ? arrPlaces[0].name : 'no selection', ack: true });
                } else {
                    adapter.setState('location.placeName', { val: 'no selection', ack: true });
                }

                const arrSchools = locations.filter(d => d.id == adapter.config.schools);
                adapter.log.debug('schools number: ' + adapter.config.schools);
                if (adapter.config.schools !== 'allschools') {
                    adapter.setState('location.schoolName', { val: arrSchools[0].name ? arrSchools[0].name : 'no selection', ack: true });
                } else {
                    adapter.setState('location.schoolName', { val: 'no selection', ack: true });
                }
            } catch (e) {
                adapter.log.warn('schoolfree set state error');
                adapter.log.error(e);
            }
        }
    });
}
function loadLocationsData() {
    adapter.getState('data.locations', (err, state) => {
        if (!state || !state.val) {
            try {
                const locations = require('./locations.json');
                adapter.setState('data.locations', { val: JSON.stringify(locations), ack: true });
            } catch (err) {
                err && adapter.log.error(err);
                adapter.log.error('Cannot parse data');
            }
        }
    });
}
function main() {
    // function for request
    loadLocationsData();
    if (adapter.config.federalState !== 0) {
        fillLocation();
        checkHolidayNames();
    } else {
        adapter.log.warn('please choose your federal state first and try again ...')
    }
}
// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}