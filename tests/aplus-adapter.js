if (!Object.setPrototypeOf)
	Object.setPrototypeOf = function(o, p) { o.__proto__ = p; return o; };
var Promise = require("../js/promise.js");

exports.resolved = Promise.resolve.bind(Promise.ES6);
exports.rejected = Promise.reject.bind(Promise.ES6);
exports.deferred = function() {
	var d = {};
	d.promise = Promise.ES6(function(resolve, reject) {
		d.resolve = resolve;
		d.reject = reject;
	});
	return d;
};

console.warn = function ignore(){};
