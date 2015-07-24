import makeConstructor from "constructors";
import makePrototype from "prototypes";
import {AdoptingPromise} from "base";


function makeCreator(proto) {
	return function as() {
		var promise = Object.create(proto);
		promise.fork = this.fork;
		promise.onsend = this.onsend;
		return promise;
	};
}
function id() {
	return this;
}

var characteristics = [["safe", "unsafe"], ["lazy", "eager"]];
export var prototypes = [];
for (var i=0, l=1<<characteristics.length; i<l; i++)
	prototypes.push(makePrototype(~i&1, ~i&2));
for (var i=0; i<prototypes.length; i++) {
	var p = prototypes[i],
	    as = makeCreator(p);
	for (var j=0; j<characteristics.length; j++) {
		var prop = characteristics[j][i>>j & 1]; // get description for characteristic of this prototype
		prototypes[i ^ 1<<j][prop] = as; // create converter on oppositional prototype
		p[prop]                    = id; // create identity  on this prototype
		p["_"+characteristics[j][0]] = !(i & 1<<j); // set feature for this characteristic
	}
}

characteristics.push(["async", "sync"], ["cancellable", "uncancellable"]); // constructors only
export var constructors = [];
for (var i=0, l=1<<characteristics.length; i<l; i++)
	constructors.push(makeConstructor(~i&1, ~i&2, ~i&4, ~i&8));
for (var i=0; i<constructors.length; i++) {
	var c = constructors[i];
	for (var j=0; j<characteristics.length; j++) {
		var prop = characteristics[j][i>>j & 1]; // get description for characteristic of this constructor
		constructors[i ^ 1<<j][prop] = c; // link from oppositional constructor
		c["_"+characteristics[j][0]] = !(i & 1<<j); // set feature for this characteristic
		c[prop] = c; // link from itself (can't be bad if one can state a characteristic explicitly)
	}
}

// link each other - &3 is equivalent to %prototypes.length
for (var i=0; i<constructors.length; i++)
	constructors[i].prototype = prototypes[i & 3];
for (var i=0; i<prototypes.length; i++)
	prototypes[i & 3].constructor = constructors[i];

// console.log(prototypes);
// console.log(constructors);
export var DefaultPromise = AdoptingPromise.default = constructors[0].safe.eager; // inherits from AdoptingPromise

export var eagerUnsafeBichain = DefaultPromise.eager.unsafe.prototype.bichain;
export var lazyUnsafeChain = DefaultPromise.lazy.unsafe.prototype.chain;

function ES6Promise(fn) {
	return new DefaultPromise.safe.eager.async.uncancellable(fn).assimilate();
}
ES6Promise.prototype = DefaultPromise.prototype;
Object.setPrototypeOf(ES6Promise, AdoptingPromise);
DefaultPromise.ES6 = ES6Promise; // or on AdoptingPromise???