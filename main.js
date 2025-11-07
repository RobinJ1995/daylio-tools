#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const math = require('mathjs');

const { filterObjects, mapObjects } = require('./utils');

const DAYLIO_PREDEFINED_MOOD_NAMES = {
    1: 'rad',
    2: 'good',
    3: 'meh',
    4: 'bad',
    5: 'awful'
};
const DAYLIO_MOOD_GROUP_VALUES = {
    1: 5,
    2: 4,
    3: 3,
    4: 2,
    5: 1,
}

const getDataFromDaylioArchive = async (archivePath) => {
    const backupArchiveFile = path.resolve(process.cwd(), archivePath);
    console.log(`Reading file: ${backupArchiveFile}`)

    const dir = await unzipper.Open.file(backupArchiveFile);
    const entry = dir.files.find(f => /(^|\/)backup\.daylio$/.test(f.path));
    if (!entry) {
        throw new Error('Could not find "backup.daylio" inside the archive.');
    }

    const base64 = (await entry.buffer()).toString('utf8');
    const json = Buffer.from(base64, 'base64').toString('utf8');

    return JSON.parse(json);
}

const getTagGroups = data => data.tag_groups.map(({ id, name, order, id_color }) => ({ id, name, order, id_color }));
const getTags = data => data.tags.map(({ id, name, order, state, id_tag_group, id_color }) => ({ id, name, order, state, id_tag_group, id_color }));
const getTagsWithGroupsPopulated = data => {
    const tagGroups = getTagGroups(data);
    const tags = getTags(data);

    return tags.map(tag => ({
        ...tag,
        group: tagGroups.find(tg => tg.id === tag.id_tag_group),
    }));
}
const getDatestamp = ({ year, month, day }) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const getEntries = data => data.dayEntries.map(({ id, minute, hour, day, month, year, datetime, mood, note, note_title, tags }) => ({ id, minute, hour, day, month, year, datetime, mood, note, note_title, tag_ids: tags, mood_id: mood, datestamp: getDatestamp({ year, month, day }) }));
const getEntriesPopulated = data => {
    const tags = getTagsWithGroupsPopulated(data);
    const moods = getMoods(data);
    const entries = getEntries(data);

    return entries.map(entry => ({
        ...entry,
        mood: moods.find(mood => mood.id === entry.mood_id),
        tags: entry.tag_ids.map(tagId => tags.find(tag => tag.id === tagId))
    }));
}
const getMoods = data => data.customMoods.map(({ id, custom_name, mood_group_id, predefined_name_id, state }) => ({
    id,
    name: custom_name || DAYLIO_PREDEFINED_MOOD_NAMES?.[predefined_name_id],
    value: DAYLIO_MOOD_GROUP_VALUES?.[mood_group_id],
}));
const getDays = data => {
    const allEntries = getEntriesPopulated(data);
    const datestamps = [...new Set(allEntries.map(({ datestamp }) => datestamp))].sort();

    return datestamps.map(datestamp => {
        const entries = allEntries.filter(entry => entry.datestamp === datestamp);
        const tags = [...new Set(entries.flatMap(entry => entry.tags))];
        const moodAverage = entries.reduce((acc, entry) => acc + entry.mood.value, 0) / entries.length;

        return {
            datestamp,
            entries,
            tags,
            moodAverage,
        }
    });
}

const getTagNames = data => getTags(data).map(tag => tag.name);
const _initTagCooccurrenceMap = data => (tagNames => tagNames.reduce((acc, i) => ({
    ...acc,
    [i]: tagNames.reduce((inner, j) => ({...inner, [j]: 0}), {})
}), {}))(getTagNames(data));
const _sortTagCooccurrenceMap = cooccurrence => Object.fromEntries(
    Object.entries(cooccurrence)
        .sort(([keyA, objA], [keyB, objB]) => {
            const sumA = Object.values(objA).reduce((acc, val) => acc + val, 0);
            const sumB = Object.values(objB).reduce((acc, val) => acc + val, 0);
            return sumB - sumA;
        })
        .map(([outerKey, innerObj]) => [
            outerKey,
            Object.fromEntries(
                Object.entries(innerObj)
                    .sort(([, a], [, b]) => b - a)
            )
        ])
);
const _getTagCooccurrence = (data, entriesSelector) => {
    const entries = entriesSelector(data);
    const cooccurrence = _initTagCooccurrenceMap(data);

    entries.forEach(entry => {
        entry.tags.forEach(tag => {
            entry.tags.forEach(cooccurringTag => {
                if (tag.name === cooccurringTag.name) {
                    return;
                }

                cooccurrence[tag.name][cooccurringTag.name]++;
            });
        });
    });

    return _sortTagCooccurrenceMap(cooccurrence);
};
const getTagCooccurrenceByEntry = data => _getTagCooccurrence(data, getEntriesPopulated);
const getTagCooccurrenceByDay = data => _getTagCooccurrence(data, getDays);
const _getMoodsByTag = (data, entriesSelector, moodValueSelector) => {
    const entries = entriesSelector(data);
    const tagNames = getTagNames(data);
    const moodsByTagName = tagNames.reduce((acc, tagName) => ({
        ...acc,
        [tagName]: []
    }), {});

    entries.forEach(entry => {
        entry.tags.forEach(tag => {
            moodsByTagName[tag.name].push(moodValueSelector(entry));
        });
    });

    const result = tagNames.reduce((acc, tagName) => ({
        ...acc,
        [tagName]: {
            ...(moodsByTagName[tagName].length > 0 ? {
                average: moodsByTagName[tagName].reduce((acc, val) => acc + val, 0) / moodsByTagName[tagName].length,
                median: math.median(moodsByTagName[tagName])
            } : { average: null, median: null}),
            moodValues: moodsByTagName[tagName],
            nEntries: moodsByTagName[tagName].length,
        }
    }), {});

    return _sortMoodsByTagMap(result);
};
const _sortMap = ((obj, keySorter = () => 0, valueSorter = () => 0) => Object.fromEntries(
    Object.entries(obj)
        .sort(([kA, vA], [kB, vB]) => (valueSorter(vB) || 0) - (valueSorter(vA) || 0))
        .sort(([kA, vA], [kB, vB]) => (keySorter(kB) || 0) - (keySorter(kA) || 0))
));
const _sortMoodsByTagMap = ((moodsByTag, key = 'average') => _sortMap(moodsByTag, () => 0, x => x.average));
const getMoodsByTagByEntry = data => _getMoodsByTag(data, getEntriesPopulated, entry => entry.mood.value);
const getMoodsByTagByDay = data => _getMoodsByTag(data, getDays, day => day.moodAverage);
const _getMoodWithVsWithout = (data, entriesSelector, moodValueSelector, minEntriesOnBothForRelevance = 0) => {
    const getNegativeTagName = tagName => `not:${tagName}`;

    const entries = entriesSelector(data);
    const tagNames = getTagNames(data);
    const moodsByTagName = tagNames.reduce((acc, tagName) => ({
        ...acc,
        [tagName]: [],
        [getNegativeTagName(tagName)]: [],
    }), {});

    entries.forEach(entry => {
        tagNames.forEach(tagName => {
            const entryHasTag = entry.tags.some(tag => tag.name === tagName);
            const moodValue = moodValueSelector(entry);

            moodsByTagName[entryHasTag ? tagName : getNegativeTagName(tagName)].push(moodValue);
        });
    });

    const result = tagNames.reduce((acc, tagName) => {
        if (moodsByTagName[tagName].length < minEntriesOnBothForRelevance
            || moodsByTagName[getNegativeTagName(tagName)].length < minEntriesOnBothForRelevance) {
            // Skip if less than `minEntriesOnBothForRelevance` entries for both entries with and without tag
            return acc;
        }

        const withVsWithout = {
            'with': {
                ...(moodsByTagName[tagName].length > 0 ? {
                    average: moodsByTagName[tagName].reduce((acc, val) => acc + val, 0) / moodsByTagName[tagName].length,
                    median: math.median(moodsByTagName[tagName])
                } : {average: null, median: null}),
                nEntries: moodsByTagName[tagName].length,
            },
            'without': {
                ...(moodsByTagName[getNegativeTagName(tagName)].length > 0 ? {
                    average: moodsByTagName[getNegativeTagName(tagName)].reduce((acc, val) => acc + val, 0) / moodsByTagName[getNegativeTagName(tagName)].length,
                    median: math.median(moodsByTagName[getNegativeTagName(tagName)])
                } : {average: null, median: null}),
                nEntries: moodsByTagName[getNegativeTagName(tagName)].length,
            }
        };

        return {
            ...acc,
            [tagName]: {
                ...withVsWithout,
                diff: {
                    average: withVsWithout.with.average - withVsWithout.without.average,
                    median: withVsWithout.with.median - withVsWithout.without.median,
                },
            }
        }
    }, {});

    return _sortMap(result, () => 0, x => x.diff.average);
}
const getMoodOnEntriesWithVsWithout = data => _getMoodWithVsWithout(data, getEntriesPopulated, entry => entry.mood.value, 3);
const getMoodOnDaysWithVsWithout = data => _getMoodWithVsWithout(data, getDays, day => day.moodAverage, 3);

(async () => {
    const arg = process.argv[2];
    if (!arg || arg === '-h' || arg === '--help') {
        console.error('Usage: node main.js <path-to-zip-archive>');
        process.exit(1);
    }

    const data = await getDataFromDaylioArchive(arg);

    const tags = getTagsWithGroupsPopulated(data);

    const r = mapObjects(getMoodOnDaysWithVsWithout(data), ([k, v]) => [k, {
        'with': v['with']['average'],
        'without': v['without']['average'],
        'diff': v['diff']['average']
    }]);

    console.log(r);
})();
