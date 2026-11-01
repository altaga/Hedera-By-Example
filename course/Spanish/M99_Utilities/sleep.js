/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

export default sleep
