if (!Object.setPrototypeOf)
	Object.setPrototypeOf = function(o, p) { o.__proto__ = p; return o; };
var Promise = require("./variants.js");

exports.resolved = Promise.resolve.bind(Promise);
exports.rejected = Promise.reject.bind(Promise);
exports.deferred = function() {
	var d = {};
	d.promise = Promise.ES6(function(resolve, reject) {
		d.resolve = resolve;
		d.reject = reject;
	});
	return d;
};

console.warn = function ignore(){};
