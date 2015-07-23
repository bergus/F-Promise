import {ContinuationBuilder, trigger} from "continuations";
import {isCancelled, makeArrayToken} from "cancellation";

function makeResolvedPromiseConstructor(state, removable) {
	return function ResolvedPromise(args) {
		var that = this,
		    handlers = null;
		function runHandlers() {
			if (!handlers) return;
			var continuations = new ContinuationBuilder();
			for (var i=0; i<handlers.length;) {
				var subscription = handlers[i++];
				if (i == handlers.length) // when looking at the last subscription
					i = handlers.length = 0; // clear the handlers array even before executing, to prevent building an adoption stack
					                         // alternatively do subscription = handlers.shift() TODO performance test
				if (isCancelled(subscription.token)) continue;
				if (subscription[state]) {
					continuations.add(subscription[state].apply(null, args));
				} else if (subscription.proceed) {
					var cont = subscription.proceed(that);
					if (cont != runHandlers) continuations.add();
				} else if (subscription.instruct && subscription.instruct.length) { // Array.isArray(subscription.instruct)
					for (var i=0; i<subscription.instruct.length; i++) {
						var sub = subscription.instruct[i];
						if (!sub.instruct) // filter out lazy handlers
							sub.resolution = that;
						else
							handlers.push(sub);
					}
					subscription.instruct = null;
				}
			}
			// assert: handlers.length == 0
			handlers = null;
			return continuations.get();
		}
		this.fork = function forkResolved(subscription) {
			if (isCancelled(subscription.token)) return;
			subscription[removable] = null;
			if (typeof subscription[state] == "function") {
				subscription.proceed = subscription.instruct = null;
				// return a generic callback to prevent multiple executions,
				// instead of just returning Function.prototype.apply.bind(handler, null, args);
				return function runHandler() {
					if (!subscription) return; // throw new Error("unsafe continuation");
					if (isCancelled(subscription.token)) return;
					var handler = subscription[state];
					subscription = null;
					return handler.apply(null, args);
				};
			} else if (typeof subscription.proceed == "function") {
				return subscription.proceed(that); // TODO should not execute immediately?
			} else if (subscription.instruct && subscription.instruct.length) { // Array.isArray(subscription.instruct)
				var j = 0;
				if (!handlers)
					handlers = subscription.instruct;
				else
					j = handlers.length;
				for (var i=0; i<subscription.instruct.length; i++) {
					var sub = subscription.instruct[i];
					// TODO? remove progress/removable from handlers right now
					if (!sub.instruct) // filter out lazy handlers
						sub.resolution = that;
					//else if (handlers == subscription.instruct) {
					//	if (j++ != i)
					//		handlers[j] = sub;
					else
						handlers[j++] = sub;
				}
				handlers.length = j;
				subscription.instruct = null;
				return runHandlers;
			}
		};
	}
}
export var FulfilledPromise = makeResolvedPromiseConstructor("success", "error");
export var RejectedPromise =  makeResolvedPromiseConstructor("error", "success");

function reject(message) {
	return new RejectedPromise([new TypeError(message)]);
}
	
export function AdoptingPromise(fn) {
// a promise that will at one point in the future adopt a given other promise
// and from then on will behave identical to that adopted promise
// since it is no more cancellable once resolved with a certain promise, that one is typically a settled one
	var handle = null,
	    that = this;
	
	this.fork = function forkAdopting(subscription) {
	// registers the onsuccess and onerror continuation handlers
	// it is expected that neither these handlers nor their continuations do throw
	// if the promise is already settled, it returns a continuation to execute
	//    them (and possibly other waiting ones) so that the handlers are *not immediately* executed
	// if the promise is not yet resolved, but there is a continuation waiting to
	//    do so (and continuatively execute the handlers), that one is returned
	// else undefined is returned
	
	// if the promise is already resolved, it forwards the subscription,
	// else if there is no handle yet, it just uses the subscription for the handle
	//      if there is a subscription handle, it replaces it with an instruction handler
	//      if there is an instruction handle, it adds the subscription on it
	
		if (subscription.proceed == adopt) // A+ 2.3.1: "If promise and x refer to the same object," (instead of throwing)
			return adopt(reject("Promise/fork: not going to wait to assimilate itself")); // "reject promise with a TypeError as the reason"
		
		if (!handle)
			handle = subscription;
		else if (handle.resolution && handle.resolution != that) { // expected to never happen
			var cont = handle.resolution.fork(subscription);
			if (this instanceof AdoptingPromise && this.fork == forkAdopting) {
				this.fork = handle.resolution.fork; // employ shortcut, empower garbage collection
				this.onsend = handle.resolution.onsend;
			}
			return cont;
		} else {
			if (!handle.instruct || !handle.instruct.length) {
				if (handle.proceed || handle.success || handle.error)
					handle = {token: null, instruct: [handle], resolution: null};
				else
					handle.instruct = [];
				Object.defineProperty(handle, "token", {get: makeArrayToken(handle.instruct), enumerable:true, configurable:true});
			}
			handle.instruct.push(subscription);
		}
		if (subscription.instruct)
			return go;
		var cont;
		// TODO: don't let advanveSubscription have access to handle etc.
		return function advanceSubscription() { // but don't request execution until the continuation has been called - implicit lazyness
			if (cont) return cont;
			if (!subscription) return go;
			var r = subscription.resolution;
			if (r && r != that && r.fork != forkAdopting)
				cont = r.fork(subscription);
			else
				subscription.instruct = true;
			subscription = null;
			return cont || go;
		}
	};
	function adopt(r) {
	// set the resolution to another promise
	// if already resolved, does nothing
	// creates an empty instruction handle if necessary
	// forwards the handle (if not a still lazy subscription)
		if (!handle)
			handle = {token: null, instruct: true, resolution: r};
		else if (handle.resolution && handle.resolution != that) return; // throw new Error("cannot adopt different promises");
		
		if (r == that) // A+ 2.3.1: "If promise and x refer to the same object," (instead of throwing)
			r = reject("Promise|adopt: not going to assimilate itself"); // "reject promise with a TypeError as the reason"
		else if (r.fork == that.fork)
			r = reject("Promise|adopt: not going to assimilate an equivalent promise");
		handle.resolution = r;
		that.fork = r.fork; // shortcut unnecessary calls, collect garbage methods
		that.onsend = r.onsend;
		
		go = null; // the aim of go continuation was to advance the resolution process until it provided us a promise to adopt
		if (!handle.instruct)
			return;
		// from now on, fork calls will return the continuation that advances the adopted promise to eventual resolution // TODO: do we need that at all?
		return go = r.fork(handle);
	}
	// expects `go` to be safe. TODO: Prove correctness. If wrapper is required, possibly unwrap when adopt() is called.
	var go = fn.call(this, adopt, function progress(event) {
		if (!handle) return;
		if (!handle.instruct || !handle.instruct.length) return !isCancelled(handle.token) && handle.progress;
		var progressHandlers = handle.instruct.filter(function(subscription) { return subscription.progress && !isCancelled(subscription.token); });
		if (progressHandlers.length == 1) return progressHandlers[0].progress;
		var conts = new ContinuationBuilder();
		for (var i=0; i<progressHandlers.length; i++)
			conts.add(trigger(progressHandlers[i].progress, arguments));
		return conts.get();
	}, function isCancellable(token) {
		// tests whether there are no (more) CancellationTokens registered with the promise,
		// and sets the token state accordingly
		if (isCancelled(token)) return true;
		if (!handle) return token.isCancelled = true; // TODO: Is it acceptable to revoke the associated token after a promise has been resolved?
		var tk = handle.token;
		return token.isCancelled = !tk || isCancelled(tk);
	});
	fn = null; // garbage collection
}

export var CommonPrototype = FulfilledPromise.prototype = RejectedPromise.prototype = AdoptingPromise.prototype;