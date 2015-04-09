function makePromiseConstructor(makeResolver) {
	// makeResolver creates a fulfill/reject resolver with methods to actually execute the continuations they might return
	function Promise(fn) {
		AdoptingPromise.call(this, function callResolver(adopt, progress) {
			return (fn.call(this, makeResolver(adopt, FulfilledPromise), makeResolver(adopt, RejectedPromise), function triggerProgress() {
				Promise.run(Promise.trigger(progress, arguments));
			}));
		});
		fn = null; // garbage collection
	}
	return Object.setPrototypeOf(Promise, AdoptingPromise);
}
var SyncPromise = makePromiseConstructor(function makeSyncResolver(adopt, constructor) {
	return function resolveSync() {
		Promise.run(adopt(new constructor(arguments)));
	};
});		
var AsyncPromise = makePromiseConstructor(function makeAsyncResolver(constructor) {
	return function resolveAsync() {
		var cont = adopt(new constructor(arguments)); // this creates the continuation immediately
		setImmediate(function runAsyncResolution() {
			Promise.run(cont);
		});
	};
});
// TODO: make a resolver that also accepts promises, not only plain fulfillment values
// TODO: make a safe constructor, make a lazy constructor

// TODO: use return value for cancellation insted of continuation

// TODO: find a comprehensive way to link them all

// unlikely: continuations (AdoptingPromise, fork), asap (synchronous callbacks)
var ContinuationPromise = makePromiseConstructor(ContinuationBuilder.safe, function makeResolver(constructor) {
	return function resolve() {
		return adopt(new constructor(arguments));
	};
});

function makeCreator(proto) {
	return function as() {
		var promise = Object.create(proto);
		promise.fork = this.fork;
		promise.onsend = this.onsend;
		return promise;
	};
}
function makeConstructor(safe, lazy, async, cancellable) {
	return {_safe:!!safe, _lazy:!!lazy, _async:!!async, _cancellable:!!cancellable};
}
var combinations = [["safe", "unsafe"], ["lazy", "strict"]],
    prototypes = [];
for (var i=0, l=1<<combinations.length; i<l; i++)
	prototypes.push(Object.create(AdoptingPromise.prototype));
for (var i=0; i<prototypes.length; i++) {
	var p = prototypes[i],
	    as = makeCreator(p);
	for (var j=0; j<combinations.length; j++) {
		prototypes[i ^ 1<<j][combinations[j][i>>j & 1]] = as;
		p["_"+combinations[j][0]] = !(i & 1<<j);
	}
}

combinations.push(["async", "sync"], ["cancellable", "uncancellable"]); // constructors only
var constructors = [];
for (var i=0, l=1<<combinations.length; i<l; i++) {
	var c = makeConstructor(~i&1, ~i&2, ~i&4, ~i&8);
	constructors.push(c);
	c.prototype = prototypes[i & 3];
	if (i>>2 == 0)
		c.prototype.constructor = c;
}
for (var i=0; i<constructors.length; i++) {
	var c = constructors[i];
	for (var j=0; j<combinations.length; j++)
		constructors[i ^ 1<<j][combinations[j][i>>j & 1]] = c;
}
console.log(prototypes);
console.log(constructors);
