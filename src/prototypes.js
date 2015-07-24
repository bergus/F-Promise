import {CommonPrototype, AdoptingPromise, of, reject} from "base";
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


function makeMapMethod(type, safe, lazy) {
	function makeMapper(build, adopt, fn) {
		if (safe)
			return function safeMapper() {
				try {
					var r = fn.apply(this, arguments);
				} catch(e) {
					return adopt(reject(e));
				}
				return adopt(build(r));
			};
		else
			return function mapper() {
				return adopt(build(fn.apply(this, arguments)));
			};
	}
	return function map(fn) {
		var promise = this;
		var fn2 = arguments[1];
		return this.create(AdoptingPromise, function mapResolver(adopt, progress, isCancellable) {
			var token = {isCancelled: false};
			this.onsend = function mapSend(msg, error) {
				if (msg != "cancel") return promise.onsend;
				// TODO: What if `fn` does cancel us?
				if (isCancellable(token))
					return new ContinuationBuilder([
						adopt(reject(error)),
						AdoptingPromise.trigger(promise.onsend, arguments)
					].reverse()).get();
			};
			var sub = {
				proceed: adopt,
				progress: progress,
				token: token,
				instruct: !lazy
			};
			if (type & 1)
				sub.success = makeMapper(of, adopt, fn);
			if (type & 2)
				sub.error = makeMapper(reject, adopt, type & 1 ? fn2 : fn);
			if (lazy)
				return promise.fork(sub);
			else
				return AdoptingPromise.runAsync(promise.fork(sub));
		});
	};
}

function wrapTry(fn) {
	return function safeWrapper() {
		try {
			return fn.apply(this, arguments);
		} catch(e) {
			return reject(e);
		}
	};
}
function makeChainMethod(type, safe, lazy) {
	return function chain(onfulfilled, onrejected) {
		var promise = this;
		return this.create(AdoptingPromise, function chainResolver(adopt, progress, isCancellable) { // TODO: respect subclass settings
			var cancellation = null,
			    token = {isCancelled: false},
			    stop = true, cont;
			this.onsend = function chainSend(msg, error) {
				if (msg != "cancel") return promise && promise.onsend;
				if (isCancellable(token)) {
					if (!promise) // there currently is no dependency, store for later
						cancellation = error; // new CancellationError("aim already cancelled") ???
					return new ContinuationBuilder([
						adopt(reject(error)),
						promise && AdoptingPromise.trigger(promise.onsend, arguments)
					].reverse()).get();
				}
			};
			function makeChainer(fn) {
				if (safe)
					fn = wrapTry(fn);
				return function chainer() {
					promise = null;
					promise = fn.apply(undefined, arguments); // A+ 2.2.5 "must be called as functions (i.e. with no this value)"
					if (cancellation) // the fn() call did cancel us:
						return AdoptingPromise.trigger(promise.onsend, ["cancel", cancellation]); // revenge!
					else if (!lazy && stop)
						cont = adopt(promise);
					else
						return adopt(promise);
				};
			}
			var go = promise.fork({
				success: type & 1 && onfulfilled && makeChainer(onfulfilled),
				error: type & 2 && onrejected && makeChainer(onrejected),
				proceed: adopt,
				progress: progress,
				token: token
			});
			if (lazy)
				return go;
			go = AdoptingPromise.runAsync(go);
			return function advanceChain() { // TODO: prove correctness
				if (cont) // this was not called before asyncRun got executed, and stop was never set to false
					return cont;
				stop = false;
				return go;
			};
		});
	};
}

export default function makePrototype(safe, lazy) {
	var p = Object.create(CommonPrototype);
	
	p.chain = makeChainMethod(1, safe, lazy);
	p.bichain = makeChainMethod(3, safe, lazy);
	
	p.map = makeMapMethod(1, safe, lazy);
	p.mapError = makeMapMethod(2, safe, lazy);
	p.bimap = makeMapMethod(3, safe, lazy);
	
	return p;
};