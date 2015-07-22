var esperanto = require("esperanto"),
    fs = require("fs");

function compile(name, create) {
	console.log("bundling")
	esperanto.bundle({
		base: 'src',
		entry: 'variants.js'
	}).then(function (bundle) {
		fs.writeFileSync('js/'+name, create(bundle));
		console.log("written "+name);
	}).catch(console.error);
}
if (require.main === module) {
	try { fs.mkdirSync('js') } catch (e) {}
	compile('promise.js', function(b) { return b.toCjs().code; });
	compile('promise.umd.js', function(b) { return b.toUmd({name: "Promise"}).code; });
}