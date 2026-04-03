'use strict';

const utils = require('@iobroker/adapter-core');
const axios = require('axios');
const fs = require('node:fs');
const tools = require('./lib/tools');

const schoolfreeURL = 'https://www.mehr-schulferien.de/api/v2.1/';

const FEDERAL_STATE_SLUGS = {
    2:  'baden-wuerttemberg',
    3:  'bayern',
    4:  'berlin',
    5:  'brandenburg',
    6:  'bremen',
    7:  'hamburg',
    8:  'hessen',
    9:  'mecklenburg-vorpommern',
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

let adapter;
const adapterName = require('./package.json').name.split('.').pop();

/**
 *
 * @param [options]
 */
function startAdapter(options) {

    options = options || {};
    Object.assign(options, { name: adapterName });

    adapter = new utils.Adapter(options);

    adapter.on('ready', main);

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
 *
 * @param {string|number} configValue 
 * @param {'federal-states'|'counties'|'cities'|'schools'} locationPath
 * @returns {string|null} Slug or null
 */
function getSlugForConfigValue(configValue, locationPath) {
    if (!configValue || configValue === 'none' ||
        configValue === 'allschools' || configValue === 'allPlaces' || configValue === 'allCounties') {
        return null;
    }

    const id = parseInt(configValue, 10);
    if (isNaN(id)) {
        // If a slug string has already been passed
        return String(configValue);
    }

    // Federal states: fixed table
    if (locationPath === 'federal-states') {
        return FEDERAL_STATE_SLUGS[id] || null;
    }

    // Counties / Cities / Schools: Slug from locations.json
    try {
        const locations = require('./admin/locations.json');
        const entry = locations.find(d => d.id === id);
        if (entry && entry.slug) {
            return entry.slug;
        }
        adapter.log.warn(`schoolfree: No slug found for ID ${id} in locations.json. Please run locationsUpdate().`);
    } catch (e) {
        adapter.log.warn(`schoolfree: Could not read locations.json: ${e}`);
    }
    return null;
}

/**
 *
 * @param {string} startDate  YYYY-MM-DD
 * @param {string} endDate    YYYY-MM-DD
 * @returns {string|null} URL path or null if no valid location config is found
 */
function buildPeriodsUrl(startDate, endDate) {
    // school
    if (adapter.config.schools !== 'allschools') {
        const slug = getSlugForConfigValue(adapter.config.schools, 'schools');
        if (slug) return `schools/${slug}/periods?start_date=${startDate}&end_date=${endDate}`;
    }
    // city
    if (adapter.config.places !== 'allPlaces') {
        const slug = getSlugForConfigValue(adapter.config.places, 'cities');
        if (slug) return `cities/${slug}/periods?start_date=${startDate}&end_date=${endDate}`;
    }
    // county
    if (adapter.config.counties !== 'allCounties') {
        const slug = getSlugForConfigValue(adapter.config.counties, 'counties');
        if (slug) return `counties/${slug}/periods?start_date=${startDate}&end_date=${endDate}`;
    }
    // federal state
    const slug = getSlugForConfigValue(adapter.config.federalState, 'federal-states');
    if (slug) return `federal-states/${slug}/periods?start_date=${startDate}&end_date=${endDate}`;

    return null;
}

async function locationsUpdate() {
    const federalStateId = parseInt(adapter.config.federalState, 10);
    const federalStateSlug = FEDERAL_STATE_SLUGS[federalStateId] || null;

    if (!federalStateSlug) {
        adapter.log.warn('schoolfree locationsUpdate: No valid federal state configured – skipping.');
        return;
    }

    /**
     *
     * @param {string} path
     * @param {object} [params]
     * @returns {Array}
     */
    async function fetchEndpoint(path, params = {}) {
        try {
            const response = await axios({
                method: 'get',
                url: `${schoolfreeURL}${path}`,
                params,
                responseType: 'json'
            });
            if (response.data && Array.isArray(response.data.data)) {
                return response.data.data;
            }
        } catch (e) {
            adapter.log.warn(`schoolfree locationsUpdate error (${path}): ${e}`);
        }
        return [];
    }

    /**
     * Picks only the fields needed for locations.json
     *
     * @param root0
     * @param root0.id
     * @param root0.name
     * @param root0.slug
     * @param root0.parent_location_id
     */
    const pick = ({ id, name, slug, parent_location_id }) => ({ id, name, slug, parent_location_id });

    let allLocations = [];

    const federalStates = await fetchEndpoint('federal-states');
    allLocations = allLocations.concat(federalStates.map(pick));
    adapter.log.debug(`schoolfree locationsUpdate: ${federalStates.length} federal states loaded`);

    const counties = await fetchEndpoint('counties', { federal_state: federalStateSlug });
    allLocations = allLocations.concat(counties.map(pick));
    adapter.log.debug(`schoolfree locationsUpdate: ${counties.length} counties loaded for ${federalStateSlug}`);

    const countyId = parseInt(adapter.config.counties, 10);
    if (!isNaN(countyId) && adapter.config.counties !== 'allCounties') {
        const countyEntry = counties.find(c => c.id === countyId);
        if (countyEntry && countyEntry.slug) {
            const cities = await fetchEndpoint('cities', { county: countyEntry.slug });
            allLocations = allLocations.concat(cities.map(pick));
            adapter.log.debug(`schoolfree locationsUpdate: ${cities.length} cities loaded for county ${countyEntry.slug}`);

            const cityId = parseInt(adapter.config.places, 10);
            if (!isNaN(cityId) && adapter.config.places !== 'allPlaces') {
                const cityEntry = cities.find(c => c.id === cityId);
                if (cityEntry && cityEntry.slug) {
                    const schools = await fetchEndpoint('schools', { city: cityEntry.slug });
                    allLocations = allLocations.concat(schools.map(pick));
                    adapter.log.debug(`schoolfree locationsUpdate: ${schools.length} schools loaded for city ${cityEntry.slug}`);
                } else {
                    adapter.log.debug(`schoolfree locationsUpdate: configured city ID ${cityId} not found in loaded cities – skipping schools`);
                }
            }
        } else {
            adapter.log.debug(`schoolfree locationsUpdate: configured county ID ${countyId} not found in loaded counties – skipping cities/schools`);
        }
    }

    if (allLocations.length > 0) {
        try {
            if (fs.existsSync(`${__dirname}/admin/locations.json`)) {
                fs.unlinkSync(`${__dirname}/admin/locations.json`);
            }
            fs.writeFileSync(`${__dirname}/admin/locations.json`, JSON.stringify(allLocations));
            adapter.log.info(`schoolfree locationsUpdate: ${allLocations.length} locations written to locations.json`);
        } catch (e) {
            adapter.log.warn(`schoolfree locationsUpdate write error: ${e}`);
        }
    } else {
        adapter.log.warn('schoolfree locationsUpdate: No locations received from API – locations.json not updated.');
    }
}

// ── checkState: Main function to check current/next holiday status and set states accordingly ──
async function checkState() {

    // calc current date
    let date = new Date();
    let monthIndex = (date.getMonth() + 1);
    let year = date.getFullYear();
    let day = date.getDate();
    let today = (`${year  }-${  (`0${  monthIndex}`).slice(-2)  }-${  (`0${  day}`).slice(-2)}`);

    // calc Tomorrow date
    let dateTomorrow = new Date(date.getTime() + (1000 * 60 * 60 * 24 * 1));
    let monthIndexTomorrow = (dateTomorrow.getMonth() + 1);
    let yearTomorrow = dateTomorrow.getFullYear();
    let dayTomorrow = dateTomorrow.getDate();
    let Tomorrow = (`${yearTomorrow  }-${  (`0${  monthIndexTomorrow}`).slice(-2)  }-${  (`0${  dayTomorrow}`).slice(-2)}`);

    const endYear = year + 2;
    const endDate = `${endYear}-${(`0${monthIndex}`).slice(-2)}-${(`0${day}`).slice(-2)}`;

    const periodsUrl = buildPeriodsUrl(today, endDate);
    if (!periodsUrl) {
        adapter.log.warn('schoolfree: No valid location configured (no slug can be determined). Please check the configuration and run locationsUpdate() if necessary.');
        stopSchoolfree();
        return;
    }

    adapter.log.debug(`schoolfree requesting: ${schoolfreeURL}${periodsUrl}`);

    // request API v2.1 from www.mehr-schulferien.de
    try {
        const _content = await axios({
            method: 'get',
            url: `${schoolfreeURL  }${periodsUrl}`,
            responseType: 'json'
        });
        const content = _content.data;
        adapter.log.debug(`schoolfree request periods done`);
        //adapter.log.debug(`schoolfree request periods: ${JSON.stringify(content.data)}`);

        if (content && content.data !== undefined) {
            let periods = content.data;

            if (adapter.config.ignorePublicHoliday) {
                adapter.log.debug('ignore public holiday');
                periods = periods.filter(d => d.is_school_vacation === true && d.starts_on !== d.ends_on);
            }

            const arrNewHoliday = periods.filter(d => d.ends_on >= today);

            const resData = arrNewHoliday.map(({ starts_on, ends_on, name }) => ({ starts_on, ends_on, name }));

            const result = resData.sort((a, b) => (a.starts_on > b.starts_on) ? 1 : -1);

            if (!result || result.length === 0) {
                adapter.log.warn('schoolfree: No vacation or holiday dates found for the configured location. Please check the configuration and the API response.');
                stopSchoolfree();
                return;
            }

            if (result[0] && result[0].starts_on !== 'undefined') {
                // Set schoolfree today
                let currentStart;
                let currentEnd;

                currentStart = result[0].starts_on.split('-');
                currentStart = (`${currentStart[2]  }.${  currentStart[1]  }.${  currentStart[0]}`);
                currentEnd = result[0].ends_on.split('-');
                currentEnd = (`${currentEnd[2]  }.${  currentEnd[1]  }.${  currentEnd[0]}`);

                if (result[0].starts_on <= today && result[0].ends_on >= today) {
                    // API v2.1: name directly from the Period object
                    adapter.log.debug(`school free name: ${result[0].name}`);
                    adapter.log.debug('school free today');

                    adapter.setState('info.today', { val: true, ack: true });
                    adapter.setState('info.current.start', { val: currentStart, ack: true });
                    adapter.setState('info.current.end', { val: currentEnd, ack: true });
                    adapter.setState('info.current.name', { val: result[0].name, ack: true });

                    adapter.log.debug(`string: ${JSON.stringify(result[0])}`);
                } else {
                    adapter.setState('info.today', { val: false, ack: true });
                }

                // Set schoolfree tomorrow
                if (result[0].starts_on <= Tomorrow && result[0].ends_on >= Tomorrow) {
                    adapter.log.debug(`school free name: ${result[0].name}`);
                    adapter.log.debug('school free tomorrow');

                    adapter.setState('info.tomorrow', { val: true, ack: true });
                    adapter.setState('info.current.start', { val: currentStart, ack: true });
                    adapter.setState('info.current.end', { val: currentEnd, ack: true });
                    adapter.setState('info.current.name', { val: result[0].name, ack: true });

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
                    nextStart = (`${nextStart[2]  }.${  nextStart[1]  }.${  nextStart[0]}`);
                    nextEnd = result[0].ends_on.split('-');
                    nextEnd = (`${nextEnd[2]  }.${  nextEnd[1]  }.${  nextEnd[0]}`);

                    adapter.setState('info.next.start', { val: nextStart, ack: true });
                    adapter.setState('info.next.end', { val: nextEnd, ack: true });
                    adapter.setState('info.next.name', { val: result[0].name, ack: true });
                } else if (result[0].starts_on <= today && result[0].ends_on >= today) {
                    if (result[1] && result[1].starts_on !== 'undefined') {
                        nextStart = result[1].starts_on.split('-');
                        nextStart = (`${nextStart[2]  }.${  nextStart[1]  }.${  nextStart[0]}`);
                        nextEnd = result[1].ends_on.split('-');
                        nextEnd = (`${nextEnd[2]  }.${  nextEnd[1]  }.${  nextEnd[0]}`);

                        adapter.setState('info.next.start', { val: nextStart, ack: true });
                        adapter.setState('info.next.end', { val: nextEnd, ack: true });
                        adapter.setState('info.next.name', { val: result[1].name, ack: true });
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
            adapter.setState('location.countieName', { val: arrCounties[0] && arrCounties[0].name ? arrCounties[0].name : 'no selection', ack: true });
        } else {
            adapter.setState('location.countieName', { val: 'no selection', ack: true });
        }

        if (adapter.config.places !== 'allPlaces' || adapter.config.places !== '') {
            const arrPlaces = locations.filter(d => d.id == adapter.config.places);
            adapter.log.debug(`places number: ${adapter.config.places}`);
            adapter.setState('location.placeName', { val: arrPlaces[0] && arrPlaces[0].name ? arrPlaces[0].name : 'no selection', ack: true });
        } else {
            adapter.setState('location.placeName', { val: 'no selection', ack: true });
        }

        if (adapter.config.schools !== 'allschools' || adapter.config.schools !== '') {
            const arrSchools = locations.filter(d => d.id == adapter.config.schools);
            adapter.log.debug(`schools number: ${adapter.config.schools}`);
            adapter.setState('location.schoolName', { val: arrSchools[0] && arrSchools[0].name ? arrSchools[0].name : 'no selection', ack: true });
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

async function main() {
    delOldObjects();
    if (adapter.config.federalState !== 'none') {
        await locationsUpdate();
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