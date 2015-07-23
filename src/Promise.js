import {CommonPrototype, AdoptingPromise as Promise, FulfilledPromise, RejectedPromise} from "base";
import {isCancelled} from "cancellation";
import {ContinuationBuilder} from "continuations";

CommonPrototype.create = function create(constructor, arg) {
// instantiates a new Promise object of the same subclass as the current instance
// using the supplied super constructor
	// TODO: optimisation
	var p = Object.getPrototypeOf(this);
//	if (p == CommonPrototype)
//		console.warn("The abstract base class should not be instantiated except for internal purposes") & console.trace();
	var o = Object.create(p);
	constructor.call(o, arg);
	return o;
};
Promise.create = function create(constructor, arg) {
// instantiates a new Promise object of the current subclass
// using the supplied super constructor
	// TODO: optimisation
//	if (this.prototype == CommonPrototype)
//		console.warn("The abstract base class should not be instantiated except for internal purposes") & console.trace();
	var o = Object.create(this.prototype);
	constructor.call(o, arg);
	return o;
};


function makeUnitFunction(constructor) {
	return function unit(val) {
		// return new constructor(arguments);
		// optimisable in V8 - http://jsperf.com/array-with-and-without-length/
		var args = [];
		switch (arguments.length) {
			case 3: args[2] = arguments[2];
			case 2: args[1] = arguments[1];
			case 1: args[0] = val;
			case 0: break;
			default:
				for (var i=0; i<arguments.length; i++)
					args[i] = arguments[i];
		}
		return this.create(constructor, args);
	};
}

Promise.of = Promise.fulfill = makeUnitFunction(FulfilledPromise);
Promise.reject = makeUnitFunction(RejectedPromise);



function makeMapping(createSubscription, build) {
	return function map(fn) {
		var promise = this;
		return this.create(Promise, function mapResolver(adopt, progress, isCancellable) { // TODO: respect subclass settings
			var token = {isCancelled: false};
			this.onsend = function mapSend(msg, error) {
				if (msg != "cancel") return promise.onsend;
				if (isCancellable(token))
					return new ContinuationBuilder([
						adopt(Promise.reject(error)),
						Promise.trigger(promise.onsend, arguments)
					].reverse()).get();
			};
			return promise.fork(createSubscription(function mapper() {
				return adopt(build(fn.apply(this, arguments)));
			}, {
				proceed: adopt,
				progress: progress,
				token: token
			}));
		});
	};
}
Promise.prototype.map      = makeMapping(function(m, s) { s.success = m; return s; }, Promise.of.bind(Promise)); // Object.set("success")
Promise.prototype.mapError = makeMapping(function(m, s) { s.error   = m; return s; }, Promise.reject.bind(Promise)); // Object.set("error")

function makeChaining(execute) {
	return function chain(onfulfilled, onrejected, explicitToken) {
		var promise = this;
		return this.create(Promise, function chainResolver(adopt, progress, isCancellable) { // TODO: respect subclass settings
			var cancellation = null,
			    token = explicitToken || {isCancelled: false},
			    strict = false, done;
			this.onsend = function chainSend(msg, error) {
				if (msg != "cancel") return promise && promise.onsend;
				if (explicitToken ? isCancelled(explicitToken) : isCancellable(token)) {
					if (!promise) // there currently is no dependency, store for later
						cancellation = error; // new CancellationError("aim already cancelled") ???
					return new ContinuationBuilder([
						adopt(Promise.reject(error)),
						promise && Promise.trigger(promise.onsend, arguments)
					].reverse()).get();
				}
			};
			function makeChainer(fn) {
				return function chainer() {
					promise = null;
					promise = fn.apply(undefined, arguments); // A+ 2.2.5 "must be called as functions (i.e. with no  this  value)"
					if (cancellation) // the fn() call did cancel us:
						return Promise.trigger(promise.onsend, ["cancel", cancellation]); // revenge!
					else if (strict)
						return adopt(promise);
					else
						done = adopt(promise);
				};
			}
			var go = execute(promise.fork({
				success: onfulfilled && makeChainer(onfulfilled),
				error: onrejected && makeChainer(onrejected),
				proceed: adopt,
				progress: progress,
				token: token
			}));
			return function advanceChain() { // TODO: prove correctness
				if (done) // this was not called before asyncRun got executed, and strict was never set to true
					return done;
				strict = true;
				return go;
			}
		});
	};
}
Promise.prototype.chainStrict = makeChaining(Promise.runAsync);
Promise.prototype.chain       = makeChaining(function(c){ return c; }); // Function.identity

Promise.method = function makeThenHandler(fn, warn) {
// returns a function that executes fn safely (catching thrown exceptions),
// and applies the A+ promise resolution procedure on the result so that it always yields a promise
	if (typeof fn != "function") {
		if (warn && fn != null) console.warn(warn + ": You must pass a function callback or null, instead of", fn);
		return null;
	}
	// var Promise = this; TODO subclassing???
	return function thenableResolvingHandler() {
		// get a value from the fn, and apply https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
		try {
			var v = fn.apply(this, arguments);
			if (v instanceof Promise) return v; // A+ 2.3.2 "If x is a promise, adopt its state"
			// if (v === undefined) console.warn("Promise::then: callback did not return a result value")
			if (Object(v) !== v) return Promise.of(v); // A+ 2.3.4 "If x is not an object or function, fulfill promise with x."
			var then = v.then; // A+ 2.3.3.1 (Note: "avoid multiple accesses to the .then property")
		} catch(e) {
			return Promise.reject(e); // A+ 2.2.7.2, 2.3.3.2 "if […] throws an exception e, reject with e as the reason."
		}
		if (typeof then != "function") // A+ 2.3.3.4 "If then is not a function, fulfill promise with x"
			return Promise.of(v);
		return new Promise.default.unsafe.uncancellable(function thenableResolver(fulfill, reject, progress) {
			try {
				// A+ 2.3.3.3 "call then with x as this, first argument resolvePromise, and second argument rejectPromise"
				then.call(v, fulfill, reject, progress); // TODO: support cancellation
			} catch(e) { // A+ 2.3.3.3.4 "If calling then throws an exception e"
				reject(e); // "reject promise with e as the reason (unless already resolved)"
			}
		}).chain(Promise.resolve); // A+ 2.3.3.3.1 "when resolvePromise is called with a value y, run [[Resolve]](promise, y)" (recursively)
	};
};

// wraps non-promises, adopts thenables (recursively), returns passed Promises directly
// TODO: subclassing
Promise.from = Promise.cast = Promise.method(function identity(v) { return v; }); // Function.identity

// like Promise.cast/from, but always returns a new promise
// TODO: subclassing
Promise.resolve = Promise.method(function getResolveValue(v) {
	if (v instanceof Promise) return v.chain(); // a new Promise (assimilating v)
	return v;
});

Promise.prototype.then = function then(onfulfilled, onrejected, onprogress, token) {
	if (arguments.length > 0 && onfulfilled == null && onrejected == null && onprogress == null)
		console.warn("Promise::then: You have passed no handler function");
	if (onprogress)
		this.fork({progress: function(event) { onprogress.apply(this, arguments); }, token: token}); // TODO: check consistency with progress spec
	return this.chainStrict(Promise.method(onfulfilled, "Promise::then"), Promise.method(onrejected, "Promise::then"), token);
};
Promise.prototype.catch = function catch_(onrejected) {
	if (typeof onrejected != "function") console.warn("Promise::catch: You must pass a function, instead of", onrejected);
	if (arguments.length <= 1)
		return this.then(null, onrejected);
	if (arguments.length == 2) {
		var tohandle = onrejected,
		    promise = this;
		onrejected = arguments[1];
		return this.chainStrict(null, Promise.method( isErrorClass(tohandle)
		  ?	function(err) {
				if (err instanceof tohandle) return onrejected.call(this, arguments);
				else return promise;
			}
		 :	function(err) {
				if (tohandle(err)) return onrejected.call(this, arguments);
				else return promise;
			}
		));
	} else {
		var args = arguments;
		return this.chainStrict(null, Promise.method(function(err) {
			for (var i=0; i<args.length; ) {
				var tohandle = args[i++];
				if (i==args.length) // odd number of args, last is a catch-all
					return tohandle.call(this, arguments);
				var onrejected = args[i++];
				if (isErrorClass(tohandle) ? err instanceof tohandle : tohandle(err))
					return onrejected.call(this, arguments);
			}
			return promise;
		}));
	} 
};
function isErrorClass(constructor) {
	if (Error.isPrototypeOf(constructor)) return true; // ES6 subclassing (or, alternatively, anything that implements @@instanceOf)
	if (constructor.prototype instanceof Error) return true; // premature optimisation
	for (var p=constructor.prototype; p!=null; p=Object.getPrototypeOf(p))
		if (Object.prototype.toString.call(p) == "[object Error]")
			return true;
	return false;
}
Promise.prototype.timeout = function timeout(ms) {
	return Promise.timeout(ms, this);
};
Promise.timeout = function timeout(ms, p) {
	return Promise.race([p, Promise.delay(ms).chain(function() {
		return Promise.reject(new Error("Timed out after "+ms+" ms"));
	})]);
};
Promise.prototype.delay = function delay(ms) {
	// a fulfillment will be held up for ms
	var promise = this;
	return this.chain(function delayHandler() {
		// var promise = new FulfilledPromise(arguments);
		return new Promise(function delayResolver(adopt, _, isCancellable) {
			var token = {isCancelled: false};
			var timerId = setTimeout(function runDelayed() {
				timerId = null;
				Promise.run(adopt(promise));
			}, ms);
			this.onsend = function delaySend(msg, error) {
				// since promise is always already resolved, we don't need to resend
				if (msg == "cancel" && isCancellable(token)) {
					if (timerId != null)
						clearTimeout(timerId);
					return adopt(Promise.reject(error));
				}
			};
		});
	});
};
Promise.delay = function delay(ms, v) {
	return Promise.from(v).delay(ms);
};

Promise.all = function all(promises, opt) {
	if (!Array.isArray(promises)) {
		promises = Array.prototype.slice.call(arguments);
		opt = 2;
	}
	var spread = opt & 2 || (typeof opt == "function"),
	    notranspose = opt & 1,
	    joiner = (typeof opt == "function") && opt;
	
	if (!promises.length)
		return joiner ? joiner() : Promise.of([]);
	
	return this.create(Promise, function allResolver(adopt, progress, isCancellable) {
		var length = promises.length,
		    cancellation = null,
		    token = {isCancelled: false},
		    left = length,
		    results = [new Array(length)],
		    waiting = new Array(length),
		    width = 1;
		function chainer() { // if joiner
			var p = joiner.apply(null, results[0])
			if (cancellation) // the joiner() call did cancel us:
				return Promise.trigger(p.onsend, ["cancel", cancellation]); // revenge!
			return adopt(p);
		}
		function notifyRest(args) {
			var continuations = new ContinuationBuilder();
			for (var j=0; j<length; j++)
				if (waiting[j])
					continuations.add(Promise.trigger(promises[j].onsend, args));
			return continuations;
		}
		this.onsend = function allSend(msg, error) {
			if (msg != "cancel")
				return notifyRest(arguments).get();
			else if (isCancellable(token)) {
				if (!left) // there currently is no dependency, store for later
					cancellation = error; // new CancellationError("aim already cancelled") ???
				var cont = adopt(Promise.reject(error));
				return notifyRest(arguments).add(cont).get();
			}
		};
		return new ContinuationBuilder(promises.map(function(promise, i) {
			return promise.fork({
				success: function allCallback(r) {
					waiting[i] = null;
					var l = arguments.length;
					if (notranspose)
						results[0][i] = arguments;
					else if (l == 1 || spread)
						results[0][i] = r;
					else {
						while (width < l)
							results[width++] = new Array(length);
						for (var j=0; j<l; j++)
							results[j][i] = arguments[j];
					}
					if (--left == 0)
						if (joiner)
							return chainer;
						else
							return adopt(new FulfilledPromise(spread ? results[0] : results));
				},
				proceed: function(/*promise*/) {
					waiting[i] = null;
					token.isCancelled = true; // revoke
					var cont = adopt(promise);
					return notifyRest(["cancel", new CancellationError("aim already rejected")]).add(cont).get();
				},
				progress: progress,
				token: waiting[i] = token
			});
		})).get();
	});
};
Promise.join = function(joiner) {
	var args = [], i = arguments.length;
	joiner = arguments[--i];
	while (i--)
		args[i] = arguments[i];
	return this.all(args, Promise.method(joiner));
};
Promise.lift = function(fn) {
	var join = Promise.method(fn);
	return function lifted(v) {
		// if (arguments.length == 1) return v.then(fn) ???
		var args = [v];
		for (var i=1; i<arguments.length; i++)
			args[i] = arguments[i]; // TODO: accept plain values?
		return Promise.all(args, join.bind(this));
	};
};

Promise.race = function(promises) {
	//if (!promises.length)
	//	return Promise.never;
	return this.create(Promise, function raceResolver(adopt, progress, isCancellable) {
		var token = {isCancelled: false};
		function notifyExcept(i, args) {
			var continuations = new ContinuationBuilder();
			for (var j=0; j<length; j++)
				if (i != j)
					continuations.add(Promise.trigger(promises[j].onsend, args));
			return continuations;
		}
		this.onsend = function raceSend(msg, error) {
			if (msg != "cancel")
				return notifyRest(-1, arguments).get();
			else if (isCancellable(token)) {
				var cont = adopt(Promise.reject(error));
				return notifyRest(-1, arguments).add(cont).get();
			}
		};
		return new ContinuationBuilder(promises.map(function(promise, i) {
			return promise.fork({
				proceed: function raceWinner(/*promise*/) {
					token.isCancelled = true; // revoke
					var cont = adopt(promise);
					return notifyExcept(i, ["cancel", new CancellationError("aim already resolved")]).add(cont).get();
				},
				progress: progress,
				token: token
			});
		}));
	});
};