const filterObjects = (object, keyFilter = () => true, valueFilter = () => true) =>
    Object.fromEntries(Object.entries(object).filter(([key, value]) => keyFilter(key) && valueFilter(value)));
const mapObjects = (object, mapper = ([key, value]) => [key, value]) =>
    Object.fromEntries(Object.entries(object).map(mapper));

module.exports = {
    filterObjects,
    mapObjects,
};