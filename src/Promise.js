import {CommonPrototype, AdoptingPromise as Promise, FulfilledPromise, RejectedPromise} from "base";
import {DefaultPromise} from "variants";
import {isCancelled, CancellationError} from "cancellation";
import {ContinuationBuilder} from "continuations";
import "aplus";
export default DefaultPromise;

Promise.prototype.catch = function catch_(onrejected) {
	if (typeof onrejected != "function") console.warn("Promise::catch: You must pass a function, instead of", onrejected);
	if (arguments.length <= 1)
		return this.then(null, onrejected);
	if (arguments.length == 2) {
		var tohandle = onrejected,
		    promise = this;
		onrejected = arguments[1];
		return this.chaineager(null, Promise.method( isErrorClass(tohandle)
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
		return this.chaineager(null, Promise.method(function(err) {
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
	return this.from(v).delay(ms);
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