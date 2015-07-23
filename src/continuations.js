import {AdoptingPromise as Promise} from './base.js';

Promise.run = function run(cont) {
	while (typeof cont == "function")
		cont = cont(); // assert: a continuation does not throw
};
Promise.runAsync = function runAsync(cont) {
	if (typeof cont != "function" || cont.isScheduled) return cont;
	var timer = setImmediate(function asyncRun() {
		timer = null;
		cont.isScheduled = instantCont.isScheduled = false;
		Promise.run(cont); // Inline?
		cont = null;
	});
	function instantCont() {
		if (!timer) return;
		clearImmediate(timer);
		return cont;
	}
	cont.isScheduled = instantCont.isScheduled = true;
	return instantCont;
};
export function trigger(handler, args) {
	while (typeof handler == "function" && handler.length) // the length (existence of a formal parameter) distinguishes it from a continuation
		handler = handler.apply(null, args);
	return handler; // continuation, or whatever else it is
};
Promise.trigger = trigger;

export function ContinuationBuilder(continuations) {
	if (continuations) {
		// filter out non-function values
		for (var i=0, j=0; i<continuations.length; i++)
			if (typeof continuations[i] == "function")
				continuations[j++] = continuations[i];
		continuations.length = j;
		this.continuations = continuations;
	} else
		this.continuations = [];
}
ContinuationBuilder.prototype.add = function add(cont) {
	if (typeof cont == "function")
		this.continuations.push(cont);
	return this;
};
ContinuationBuilder.prototype.each = function each(elements, iterator) {
	for (var i=0, cont; i<elements.length; i++)
		if (typeof (cont = iterator(elements[i])) == "function")
			this.continuations.push(cont);
	return this;
};
ContinuationBuilder.prototype.eachSimilar = function each(elements, iterator) {
	for (var i=0, cont; i<elements.length; i++) {
		if (typeof (cont = iterator(elements[i])) == "function") {
			this.continuations.push(cont);
			for (var c; ++i<elements.length;)
				if ((c = iterator(elements[i])) != cont && typeof c == "function")
					this.continuations.push(cont = c);
			break;
		}
	}
	return this;
};
ContinuationBuilder.prototype.get = function getJoined() {
	return ContinuationBuilder.join(this.continuations);
};
ContinuationBuilder.join = function joinContinuations(continuations) {
	if (continuations.length <= 1) return continuations[0];
	return function runBranches() {
		var l = continuations.length;
		if (!l) return;
		for (var i=0, j=0; i<l; i++) {
			// TODO: Implement debugging
			var cont = continuations[i];
			cont = cont(); // assert: cont != runBranches ???
			if (typeof cont == "function")
				continuations[j++] = cont;
		}
		continuations.length = j;
		return (j <= 1) ? continuations[0] : runBranches;
	};
};
ContinuationBuilder.safe = function makeSafeContinuation(fn) {
	if (typeof fn != "function")
		return fn;
	if (typeof fn.safeContinuation == "function")
		return fn.safeContinuation;
	// prevents multiple invocations of the same continuation (which is possibly unsafe)
	function safeContinuation() {
		if (typeof fn != "function")
			return fn;
		var cont = fn();
		if (cont == fn) // it's volatile, it must be safe!
			return cont;
		fn = cont;
		return safeContinuation; // returns itself (volatile)
	}
	// fn.safeContinuation = safeContinuation;
	safeContinuation.safeContinuation = safeContinuation;
	return safeContinuation;
};