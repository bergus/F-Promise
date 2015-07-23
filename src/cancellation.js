import {CommonPrototype} from "base";
import {ContinuationBuilder, trigger} from "continuations";

CommonPrototype.onsend = function noHandler(event) {};
CommonPrototype.send = function send() {
	return Promise.run(Promise.trigger(this.onsend, arguments));
};

CommonPrototype.cancel = function cancel(reason, token) {
	if (this.onsend == CommonPrototype.onsend) // needs to be still pending, with the ability to send messages
		return false;
	if (!(reason && reason instanceof Error && reason.cancelled===true))
		reason = new CancellationError(reason || "cancelled operation");
	if (token)
		token.isCancelled = true; // revoke it
	Promise.run(Promise.trigger(this.onsend, ["cancel", reason]));
};

export function CancellationError(message) {
	// TODO: inherit from Error prototypical, not parasitic
	var error = new Error(message);
	error.name = "CancellationError";
	error.cancelled = true;
	return error;
}
export function isCancelled(token) {
	// it is cancelled when token exists, and .isCancelled yields true
	return !!token && (token.isCancelled === true || (token.isCancelled !== false && token.isCancelled()));
}
export function makeArrayToken(handlers) {
	return function tokenGetter() {
		var uncancelledTokens = 0;
		// remove cancelled subscriptions (whose token has been revoked)
		for (var i=0, j=0; i<handlers.length; i++) {
			var token = handlers[i].token;
			if (!isCancelled(token)) { // no noken, or not cancelled
				if (token) uncancelledTokens++;
				if (j++!=i) handlers[j] = handlers[i]; // overwrites cancelled token if necessary
			}
		}
		handlers.length = j;
		return !uncancelledTokens
		 ?	null // no token
		 :	{ // an uncancelled token
				isCancelled: false // holds at least as long as the handlers are the "same". Is a (handlers.length == j) test necessary?
			};
	};
}

CommonPrototype.cancellable = function(onCancel) {
	// returns new promise, registers instruct token
	if (typeof onCancel != "function") console.warn("Promise::cancellable: you must pass a callback function, instead of "+typeof onCancel);
	var promise = this;
	return this.create(AdoptingPromise, function cancellableResolver(adopt, progress, isCancellable) {
		var token = {isCancelled: false};
		this.onsend = function mapSend(msg, error) {
			if (msg != "cancel") return promise.onsend;
			if (isCancellable(token))
				var cont = adopt(Promise.reject(error));
				onCancel(error);
				return new ContinuationBuilder([
					Promise.trigger(promise.onsend, arguments),
					cont
				]).get();
		};
		return promise.fork({proceed: adopt, progress: progress, token: token});
	});
};
CommonPrototype.uncancellable = function(onCancelAttempt) {
	// returns new promise, registers instruct token
	var promise = this;
	return this.create(AdoptingPromise, function uncancellableResolver(adopt, progress, isCancellable) {
		this.onsend = function mapSend(msg, error) {
			if (msg != "cancel") return promise.onsend;
			// isCancellable({}) TODO: remove cancelled handlers
			if (onCancelAttempt != null)
				onCancelAttempt(error);
			// return undefined - does not reject anything, does not propagate cancellation.
		};
		return promise.fork({proceed: adopt, progress: progress, token: {isCancelled: false}});
	});
}
CommonPrototype.finally = function(finalisation) {
	// returns new promise, registers instruct token
	if (typeof finalisation != "function") console.warn("Promise::finally: you must pass a callback function, instead of "+typeof onCancel);
	var promise = this;
	return this.create(AdoptingPromise, function finalisationResolver(adopt, progress, isCancellable) {
		var token = {isCancelled: false};
		this.onsend = function mapSend(msg, error) {
			if (!promise) return;
			if (msg != "cancel") return promise.onsend;
			if (isCancellable(token))
				var cont2 = adopt(Promise.reject(error)),
				    cont1 = Promise.trigger(promise.onsend, arguments);
				try {
					finalisation(promise); // ignores the possibly returned promise. TODO???
				} finally {
					return new ContinuationBuilder([cont1, cont2]).get();
				}
		};
		var fin = Promise.method(finalisation);
		return promise.fork({
			proceed: function(p) {
				p = promise; // shouldn't matter
				promise = null; // prevent cancellations
				return fin(p).fork({
					proceed: function() { // await the finalisation
						return adopt(p);
					},
					progress: progress
				});
			},
			progress: progress,
			token: token
		});
	});
};