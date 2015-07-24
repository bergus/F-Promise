import {AdoptingPromise as Promise} from "base";
import {eagerUnsafeBichain, lazyUnsafeChain, DefaultPromise} from "variants";

Promise.method = function makeThenHandler(fn, warn) {
// returns a function that executes fn safely (catching thrown exceptions),
// and applies the A+ promise resolution procedure on the result so that it always yields a promise
	if (typeof fn != "function") {
		if (warn && fn != null) console.warn(warn + ": You must pass a function callback or null, instead of", fn);
		return null;
	}
	var Promise = this;
	return function thenableResolvingHandler() {
		// get a value from the fn, and assimilate thenables
		try {
			var v = fn.apply(this, arguments);
		} catch(e) {
			return Promise.reject(e); // A+ 2.2.7.2, 2.3.3.2 "if […] throws an exception e, reject with e as the reason."
		}
		return Promise.from(v);
	};
};

// wraps non-promises, adopts thenables (recursively), returns passed Promises directly
// ! requires Promise constructor context
Promise.from = function from(v) {
	// apply https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
	if (v instanceof this) return v; // A+ 2.3.2 "If x is a promise, adopt its state"
	// if (v === undefined) console.warn("Promise::then: callback did not return a result value")
	if (Object(v) !== v) return this.of(v); // A+ 2.3.4 "If x is not an object or function, fulfill promise with x."
	try {
		var then = v.then; // A+ 2.3.3.1 (Note: "avoid multiple accesses to the .then property")
	} catch(e) {
		return this.reject(e); // A+ 2.2.7.2, 2.3.3.2 "if […] throws an exception e, reject with e as the reason."
	}
	if (typeof then != "function") // A+ 2.3.3.4 "If then is not a function, fulfill promise with x"
		return this.of(v);
	return this.create(DefaultPromise.eager.safe.async.uncancellable, function thenableResolver(fulfill, reject, progress) {
		try {
			// A+ 2.3.3.3 "call then with x as this, first argument resolvePromise, and second argument rejectPromise"
			then.call(v, fulfill, reject, progress); // TODO: support cancellation
		} catch(e) { // A+ 2.3.3.3.4 "If calling then throws an exception e"
			reject(e); // "reject promise with e as the reason (unless already resolved)"
		}
	}).assimilate(); // A+ 2.3.3.3.1 "when resolvePromise is called with a value y, run [[Resolve]](promise, y)" (recursively)
};

// like Promise.cast/from, but always returns a new promise
Promise.resolve = function resolve(v) {
	if (v instanceof this) return v.chain(); // a new Promise (assimilating v)
	return this.from(v);
};

Promise.prototype.then = function then(onfulfilled, onrejected, onprogress) {
	if (arguments.length > 0 && onfulfilled == null && onrejected == null && onprogress == null)
		console.warn("Promise::then: You have passed no handler function");
	if (onprogress)
		this.fork({progress: function(event) { onprogress.apply(this, arguments); }}); // TODO: check consistency with progress spec
	return eagerUnsafeBichain.call(this, Promise.method(onfulfilled, "Promise::then"), Promise.method(onrejected, "Promise::then"));
};

Promise.prototype.assimilate = function assimilate() {
	return lazyUnsafeChain.call(this, Promise.from.bind(Promise));
};
