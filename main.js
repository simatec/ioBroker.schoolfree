'use strict';

const utils = require('@iobroker/adapter-core');
const axios = require('axios');
const fs = require('node:fs');
const tools = require('./lib/tools');

const schoolfreeURL = 'https://www.mehr-schulferien.de/api/v2.1';

const FEDERAL_STATE_SLUGS = {
    2: 'baden-wuerttemberg',
    3: 'bayern',
    4: 'berlin',
    5: 'brandenburg',
    6: 'bremen',
    7: 'hamburg',
    8: 'hessen',
    9: 'mecklenburg-vorpommern',
    10: 'niedersachsen',
    11: 'nordrhein-westfalen',
    12: 'rheinland-pfalz',
    13: 'saarland',
    14: 'sachsen',
    15: 'sachsen-anhalt',
    16: 'schleswig-holstein',
    17: 'thueringen',
};

let timerRequest;

/**
 * The adapter instance
 *
 */
let adapter;
const adapterName = require('./package.json').name.split('.').pop();

/**
 * Starts the adapter instance
 *
 * @param [options]
 */
function startAdapter(options) {

    options = options || {};
    Object.assign(options, { name: adapterName });

    adapter = new utils.Adapter(options);

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

function stopSchoolfree() {
    timerRequest = setTimeout(function () {
        adapter.log.debug('schoolfree stopped ...')
        adapter.stop();
    }, 30000);
}

/** 
 * Resolves the location type path and slug for a given location ID by checking federal states, counties, cities, and schools in that order.
 *
 * @param {string|number} locationId
 * @returns {{ locationTypePath: string, slug: string }|null}
 */
async function resolveLocationPath(locationId) {
    const id = parseInt(locationId);

    if (FEDERAL_STATE_SLUGS[id]) {
        return { locationTypePath: 'federal-states', slug: FEDERAL_STATE_SLUGS[id] };
    }

    const locationTypes = ['counties', 'cities', 'schools'];
    for (const locType of locationTypes) {
        try {
            const response = await axios({
                method: 'get',
                url: `${schoolfreeURL}/${locType}`,
                responseType: 'json',
            });
            if (response && response.data && response.data.data) {
                const found = response.data.data.find(d => d.id == id);
                if (found) {
                    return { locationTypePath: locType, slug: found.slug };
                }
            }
        } catch (e) {
            adapter.log.debug(`resolveLocationPath: error querying ${locType}: ${e}`);
        }
    }
    return null;
}

async function locationsUpdate() {
    try {
        const locationTypes = [
            { path: 'federal-states', parentId: 1 },
            { path: 'counties', parentId: null },
            { path: 'cities', parentId: null },
            { path: 'schools', parentId: null },
        ];

        let allLocations = [];

        allLocations.push({ name: 'Deutschland', id: 1, parent_location_id: null });

        for (const locType of locationTypes) {
            try {
                const response = await axios({
                    method: 'get',
                    url: `${schoolfreeURL}/${locType.path}`,
                    responseType: 'json',
                });

                adapter.log.debug(`schoolfree request ${locType.path} done`);

                if (response && response.data && response.data.data) {
                    const mapped = Object.values(response.data.data).map(
                        ({ name, id, parent_location_id }) => ({ name, id, parent_location_id })
                    );
                    allLocations = allLocations.concat(mapped);
                } else {
                    adapter.log.warn(`schoolfree request ${locType.path} error... API not reachable!!`);
                }
            } catch (e) {
                adapter.log.warn(`schoolfree request ${locType.path} error: ${e}`);
            }
        }

        adapter.log.debug(`schoolfree locationsUpdate: ${allLocations.length} locations collected`);

        if (fs.existsSync(`${__dirname}/admin/locations.json`)) {
            fs.unlinkSync(`${__dirname}/admin/locations.json`);
        }
        fs.writeFileSync(`${__dirname}/admin/locations.json`, JSON.stringify(allLocations));

    } catch (e) {
        adapter.log.warn(`schoolfree locationsUpdate error: ${e}`);
        stopSchoolfree();
    }
}

async function checkState() {

    // calc current date
    let date = new Date();
    let monthIndex = (date.getMonth() + 1);
    let year = date.getFullYear();
    let day = date.getDate();
    let today = (`${year}-${(`0${monthIndex}`).slice(-2)}-${(`0${day}`).slice(-2)}`);

    // calc Tomorrow date
    let dateTomorrow = new Date(date.getTime() + (1000 * 60 * 60 * 24 * 1));
    let monthIndexTomorrow = (dateTomorrow.getMonth() + 1);
    let yearTomorrow = dateTomorrow.getFullYear();
    let dayTomorrow = dateTomorrow.getDate();
    let Tomorrow = (`${yearTomorrow}-${(`0${monthIndexTomorrow}`).slice(-2)}-${(`0${dayTomorrow}`).slice(-2)}`);
    let federalStateId = adapter.config.federalState;
    let effectiveLocationId = federalStateId;
    let searchLocation = [];

    try {
        const locations = require('./admin/locations.json');

        if (adapter.config.schools && adapter.config.schools !== 'allschools' && adapter.config.schools !== '') {
            const found = locations.filter(d => d.id == adapter.config.schools);
            if (found.length > 0) {
                effectiveLocationId = adapter.config.schools;
            }
        } else if (adapter.config.places && adapter.config.places !== 'allPlaces' && adapter.config.places !== '') {
            const found = locations.filter(d => d.id == adapter.config.places);
            if (found.length > 0) {
                effectiveLocationId = adapter.config.places;
            }
        } else if (adapter.config.counties && adapter.config.counties !== 'allCounties' && adapter.config.counties !== '') {
            const found = locations.filter(d => d.id == adapter.config.counties);
            if (found.length > 0) {
                effectiveLocationId = adapter.config.counties;
            }
        }
    } catch (e) {
        adapter.log.debug(`schoolfree: locations.json not readable, using federalState only: ${e}`);
    }

    const locationPath = await resolveLocationPath(effectiveLocationId);
    if (!locationPath) {
        adapter.log.warn(`schoolfree: could not resolve slug for location id ${effectiveLocationId}`);
        stopSchoolfree();
        return;
    }

    // request API v2.1 from www.mehr-schulferien.de
    try {
        const _content = await axios({
            method: 'get',
            url: `${schoolfreeURL}/${locationPath.locationTypePath}/${locationPath.slug}/periods`,
            params: {
                start_date: today,
            },
            responseType: 'json',
        });
        const content = _content.data;
        adapter.log.debug(`schoolfree request periods done`);

        if (content && content.data !== undefined) {
            let resData;
            if (adapter.config.ignorePublicHoliday) {
                adapter.log.debug('ignore public holiday');
                resData = content.data.filter(d => !d.is_public_holiday && d.starts_on !== d.ends_on);
            } else {
                resData = content.data;
            }

            resData = resData.filter(d => d.ends_on >= today);

            const result = resData.sort((a, b) => (a.starts_on > b.starts_on) ? 1 : -1);

            if (!result || result.length === 0) {
                adapter.log.warn('schoolfree: no upcoming holiday data found');
                stopSchoolfree();
                return;
            }

            if (result[0] && result[0].starts_on !== 'undefined') {
                // Set schoolfree today
                let currentStart;
                let currentEnd;

                currentStart = result[0].starts_on.split('-');
                currentStart = (`${currentStart[2]}.${currentStart[1]}.${currentStart[0]}`);
                currentEnd = result[0].ends_on.split('-');
                currentEnd = (`${currentEnd[2]}.${currentEnd[1]}.${currentEnd[0]}`);

                const currentName = result[0].name || '';

                if (result[0].starts_on <= today && result[0].ends_on >= today) {
                    adapter.log.debug(`school free name: ${currentName}`);
                    adapter.log.debug('school free today');

                    adapter.setState('info.today', { val: true, ack: true });
                    adapter.setState('info.current.start', { val: currentStart, ack: true });
                    adapter.setState('info.current.end', { val: currentEnd, ack: true });
                    adapter.setState('info.current.name', { val: currentName, ack: true });

                    adapter.log.debug(`string: ${JSON.stringify(result[0])}`);
                } else {
                    adapter.setState('info.today', { val: false, ack: true });
                }

                // Set schoolfree tomorrow
                if (result[0].starts_on <= Tomorrow && result[0].ends_on >= Tomorrow) {
                    adapter.log.debug(`school free name: ${currentName}`);
                    adapter.log.debug('school free tomorrow');

                    adapter.setState('info.tomorrow', { val: true, ack: true });
                    adapter.setState('info.current.start', { val: currentStart, ack: true });
                    adapter.setState('info.current.end', { val: currentEnd, ack: true });
                    adapter.setState('info.current.name', { val: currentName, ack: true });

                    adapter.log.debug(`string: ${JSON.stringify(result[0])}`);
                } else if (result[1] && result[1].starts_on == Tomorrow) {
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
                    nextStart = (`${nextStart[2]}.${nextStart[1]}.${nextStart[0]}`);
                    nextEnd = result[0].ends_on.split('-');
                    nextEnd = (`${nextEnd[2]}.${nextEnd[1]}.${nextEnd[0]}`);

                    adapter.setState('info.next.start', { val: nextStart, ack: true });
                    adapter.setState('info.next.end', { val: nextEnd, ack: true });
                    adapter.setState('info.next.name', { val: currentName, ack: true });
                } else if (result[0].starts_on <= today && result[0].ends_on >= today) {
                    if (result[1] && result[1].starts_on !== 'undefined') {
                        const nextName = result[1].name || '';
                        nextStart = result[1].starts_on.split('-');
                        nextStart = (`${nextStart[2]}.${nextStart[1]}.${nextStart[0]}`);
                        nextEnd = result[1].ends_on.split('-');
                        nextEnd = (`${nextEnd[2]}.${nextEnd[1]}.${nextEnd[0]}`);

                        adapter.setState('info.next.start', { val: nextStart, ack: true });
                        adapter.setState('info.next.end', { val: nextEnd, ack: true });
                        adapter.setState('info.next.name', { val: nextName, ack: true });
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
    } catch (e) {
        adapter.log.warn(`schoolfree request error... API not reachable: ${e}`);
        stopSchoolfree();
    }
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
    //locationsUpdate(); // only for update locations.json
    delOldObjects();
    if (adapter.config.federalState !== 'none') {
        fillLocation();
        checkState();
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