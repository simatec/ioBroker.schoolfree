'use strict';

const utils = require('@iobroker/adapter-core');
const axios = require('axios').default;
const fs = require('fs');
const tools = require('./lib/tools');

const schoolfreeURL = 'https://www.mehr-schulferien.de/api/v2.0/';

/** @type {number | undefined} */
let timerRequest;

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

async function checkHolidayNames() {
    await axios({
        method: 'get',
        baseURL: schoolfreeURL,
        url: '/holiday_or_vacation_types/',
        responseType: 'json'
    }).then(function (response) {
        const content = response.data;
        adapter.log.debug(`schoolfree request holiday_or_vacation_types done`);
        adapter.log.debug(`schoolfree request holiday_or_vacation_types: ${JSON.stringify(content.data)}`);
        if (content && content.data !== undefined) {
            try {
                checkState(content.data);
            } catch (e) {
                adapter.log.warn(`schoolfree request holiday_or_vacation_types error: ${e}`);
                stopSchoolfree();
            }
        } else {
            adapter.log.warn('schoolfree request holiday_or_vacation_types error... API not reachable!!');
            stopSchoolfree();
        }
    }).catch(function (error) {
        adapter.log.warn(`schoolfree request holiday_or_vacation_types error: ${error}`);
        stopSchoolfree();
    })
}

function stopSchoolfree() {
    timerRequest = setTimeout(function () {
        adapter.log.debug('schoolfree stopped ...')
        adapter.stop();
    }, 30000);
}
// only for update locations.json
async function locationsUpdate() {

    await axios({
        method: 'get',
        baseURL: schoolfreeURL,
        url: '/locations/',
        responseType: 'json'
    }).then(function (response) {
        const content = response.data;
        adapter.log.debug(`schoolfree request locations done`);
        
        if (content && content.data !== undefined) {
            try {
                const result = Object.values(content.data).map(({ name, id, parent_location_id }) => ({ name, id, parent_location_id }));

                adapter.log.debug(`schoolfree request locations: ${JSON.stringify(result)}`);

                if (fs.existsSync(__dirname + '/admin/locations.json')) {
                    fs.unlinkSync(__dirname + '/admin/locations.json');
                }
                fs.writeFileSync(__dirname + '/admin/locations.json', JSON.stringify(result));
            } catch (e) {
                adapter.log.warn(`schoolfree request locations error: ${e}`);
                stopSchoolfree();
            }
        } else {
            adapter.log.warn('schoolfree request locations error... API not reachable!!');
            stopSchoolfree();
        }
    }).catch(function (error) {
        adapter.log.warn(`schoolfree request locations error: ${error}`);
        stopSchoolfree();
    })
}

async function checkState(holidayNames) {

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
    await axios({
        method: 'get',
        baseURL: schoolfreeURL,
        url: '/periods/',
        responseType: 'json'
    }).then(function (response) {
        const content = response.data;
        adapter.log.debug(`schoolfree request periods done`);
        adapter.log.debug(`schoolfree request periods: ${JSON.stringify(content.data)}`);

        let federalStateStr = 0;
        /** @type {never[]} */
        let searchLocation = [];

        if (content && content.data !== undefined) {
            if (adapter.config.schools !== 'allschools') {
                searchLocation = Object.values(content.data).filter(d => d.location_id == adapter.config.schools);
            }
            if (JSON.stringify(searchLocation) !== '[]') {
                federalStateStr = adapter.config.schools;
            } else {
                if (adapter.config.places !== 'allPlaces') {
                    searchLocation = Object.values(content.data).filter(d => d.location_id == adapter.config.places);
                }
                if (JSON.stringify(searchLocation) !== '[]') {
                    federalStateStr = adapter.config.places;
                } else {
                    if (adapter.config.counties !== 'allCounties') {
                        searchLocation = Object.values(content.data).filter(d => d.location_id == adapter.config.counties);
                    }
                    if (JSON.stringify(searchLocation) !== '[]') {
                        federalStateStr = adapter.config.counties;
                    } else {
                        federalStateStr = adapter.config.federalState;
                    }
                }
            }
        } else {
            adapter.log.warn('schoolfree request periods error... API not reachable!!');
            stopSchoolfree();
        }

        // Filter current federal State
        if (content && content.data !== undefined) {
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
            let currentName = Object.values(holidayNames).filter(d => d.id == result[0].holiday_or_vacation_type_id);
            let nextName = Object.values(holidayNames).filter(d => d.id == result[1].holiday_or_vacation_type_id);

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

                    adapter.log.debug(`string: ${JSON.stringify(result[0])}`);
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

                    adapter.log.debug(`string: ${JSON.stringify(result[0])}`);
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
                stopSchoolfree();
            } else {
                adapter.log.warn('schoolfree cannot request... API not reachable!!');
                stopSchoolfree();
            }
        } else {
            adapter.log.warn(`schoolfree request error... API not reachable!!`);
            stopSchoolfree();
        }
    }).catch(function (error) {
        adapter.log.warn(`schoolfree request error... API not reachable: ${error}`);
        stopSchoolfree();
    })
}
function fillLocation() {
    try {
        const locations = require('./admin/locations.json');

        if (adapter.config.counties !== 'allCounties' || adapter.config.counties !== '') {
            const arrCounties = locations.filter(d => d.id == adapter.config.counties);
            adapter.log.debug(`counties number: ${adapter.config.counties}`);
            adapter.setState('location.countieName', { val: arrCounties[0].name ? arrCounties[0].name : 'no selection', ack: true });
        } else {
            adapter.setState('location.countieName', { val: 'no selection', ack: true });
        }

        if (adapter.config.places !== 'allPlaces' || adapter.config.places !== '') {
            const arrPlaces = locations.filter(d => d.id == adapter.config.places);
            adapter.log.debug(`places number: ${adapter.config.places}`);
            adapter.setState('location.placeName', { val: arrPlaces[0].name ? arrPlaces[0].name : 'no selection', ack: true });
        } else {
            adapter.setState('location.placeName', { val: 'no selection', ack: true });
        }

        if (adapter.config.schools !== 'allschools' || adapter.config.schools !== '') {
            const arrSchools = locations.filter(d => d.id == adapter.config.schools);
            adapter.log.debug(`schools number: ${adapter.config.schools}`);
            adapter.setState('location.schoolName', { val: arrSchools[0].name ? arrSchools[0].name : 'no selection', ack: true });
        } else {
            adapter.setState('location.schoolName', { val: 'no selection', ack: true });
        }
    } catch (e) {
        adapter.log.warn(`schoolfree set state error: ${e}`);
    }
}

function delOldObjects() {
    adapter.getState('data.locations', (err, state) => {
        if (state) {
            adapter.delObject('data.locations');
            adapter.delObject('data');
        }
    });
}

function main() {
    //locationsUpdate(); only for update locations.json
    delOldObjects();
    if (adapter.config.federalState !== 'none') {
        fillLocation();
        checkHolidayNames();
    } else {
        stopSchoolfree();
    }
}
// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}