const { version } = require('./package.json');
const isCallable = require('./utilities/isCallable');
const isRegExp = require('./utilities/isRegExp');
const isString = require('./utilities/isString');
const escapeRegExp = require('./utilities/escapeRegExp');

const reAll = /\*\s*/;
const reAllAtFirst = /^\*/;
const reAliasSep = /\s+as\s+/;
const reAllAsAlias = /\*\s*as\s*/;
const reAliases = /((,?\s*)[$0-9a-zA-Z_]+\s+as\s+[$0-9a-zA-Z_]+)/g;
const reFunctionAtFirst = /^function/;
const reAllWithFromExpression = /\*\s+from\s+(['"`][@$0-9a-zA-Z_\s-.\/]+['"`])/gm;
const reWithFromExpression = /^(([*0-9a-zA-Z_,\s]+)?\s+from\s+(['"`][@$0-9a-zA-Z_\s-.\/]+['"`])?|[0-9a-zA-Z_,]+)/gm;
const reOpeningBraceAtFirst = /^\{/;
const reOpeningAtFirstAndOrClosingBraceAtEnd = /^\{\s*|\s*\}$/g;
const reAnyBraceOrComma = /(\{)\s*|\s*(,)\s*|\s*(\})$/g;
const reBraceOpeningAtFristOrCommaOrBraceClosing = /^\{\s*|\s*(,)\s*|\s*\}$/g;
const reBraceOpeningOrCommaOrBraceClosing = /\{\s*|\s*(,)\s*|\s*\}/g;
const reImportExpressionWithDefault = /^(?!\{)(?:([0-9a-zA-Z_]+))\s*,\s*(\{?\s*[*0-9a-zA-Z_,\s]+\s*\}?)\s+/;
const reImportDeclaration = /^(?!\/\/|\*)import\s+(((?:[0-9a-zA-Z_]+\s*,\s*)?\{?\s*[$*0-9a-zA-Z_,\s]+\s*\}?)\s+from\s+)?(['"`][@$0-9a-zA-Z_\s-.\/]+['"`])/gm;
const reExportDeclaration = /^export\s+(default)?\s*(const|let|var|class[^{]*|interface[^{]*|function[^(]*|\(.*\)[^>]*|\*\s+from\s+['"`][@$0-9a-zA-Z_\s-.\/]+['"`]|[0-9a-zA-Z_{*\s,}]+from\s+['"`][@$0-9a-zA-Z_\s-.\/]+['"`]|[0-9a-zA-Z_{}\s*,]+)?\s*([0-9a-zA-Z_]+)?/gm;
const reExportSimply = /^export\s*/;

let opts = Object.create(null);
function transform(source, options) {
	opts = Object.assign(Object.create(null), options);
	opts.match = opts.escapeRegExp ? escapeRegExp(opts.match) : opts.match;
	opts.match = isString(opts.match) ? new RegExp(opts.match, opts.flags) : (isRegExp(opts.match) ? opts.match : '');
	opts.replaceBy = isString(opts.replaceBy) || isCallable(opts.replaceBy) ? opts.replaceBy : '';
	return transformExportDeclarations(transformImportDeclarations(source, opts), opts);
}

function reduceAliasesFromImport(aliases, item) {
	reAliasSep.lastIndex = 0;
	if (reAliasSep.test(item)) {
		aliases[aliases.length] = item;
	}
	return aliases;
}

function parseExpression($match, $exp, $uri) {
	reOpeningAtFirstAndOrClosingBraceAtEnd.lastIndex = 0;
	reBraceOpeningAtFristOrCommaOrBraceClosing.lastIndex = 0;
	reAllAsAlias.lastIndex = 0;
	reAll.lastIndex = 0;
	if (reOpeningAtFirstAndOrClosingBraceAtEnd.test($exp)) {
		const expressions = $exp.replace(reBraceOpeningAtFristOrCommaOrBraceClosing, '$1').split(',');
		const expressionWithoutAliases = $exp.replace(reAliases, '').replace(/(?:^(\{\s*),*)/g, '$1');
		const aliases = expressions.reduce(reduceAliasesFromImport, []);
		const named = `const ${expressionWithoutAliases} = require(${$uri});`;
		return aliases.reduce((accumulator, item, index, list) => {
			const chunk = item.replace(reAliasSep, ',').split(',');
			const semicolon = index === list.length - 1 ? '' : ';';
			accumulator[accumulator.length] = `const ${chunk[1]} = require(${$uri}).${chunk[0]}${semicolon}`;
			return accumulator;
		}, [named]).join('\n');
	} else if (reAll.test($exp)) {
		return `const ${$exp.replace(reAllAsAlias, '')} = require(${$uri})`;
	}
	return '';
}

function parseDefaultExpression($match, $exp, $uri) {
	reAnyBraceOrComma.lastIndex = 0;
	const raw = $exp.replace(reAnyBraceOrComma, '$1$2$3');
	const brackeIndex = raw.indexOf(',{');
	const sepIndex = raw.indexOf(',*');
	let rawName;
	let rawExpression;
	if (~brackeIndex) {
		rawName = raw.substr(0, brackeIndex);
		rawExpression = raw.substr(brackeIndex + 1, raw.length);
	} else if (~sepIndex) {
		rawName = raw.substr(0, sepIndex);
		rawExpression = raw.substr(sepIndex + 1, raw.length);
	}
	const defaultData = `const ${rawName} = require(${$uri}).default || require(${$uri})`;
	const expressions = parseExpression(rawExpression, $uri);
	return `${defaultData}\n${expressions}`;
}

function parseImportDeclaration($match, $var, $exp, $uri) {
	reImportExpressionWithDefault.lastIndex = 0;
	$uri = $uri.replace(opts.match, opts.replaceBy);
	if (reImportExpressionWithDefault.test($exp)) {
		return parseDefaultExpression($match, $exp, $uri);
	} else if (reAliasSep.test($exp)) {
		return parseExpression($match, $exp, $uri);
	} else if ($exp === undefined) {
		return `require(${$uri})`;
	}
	return `const ${$exp} = require(${$uri})`;
}

function transformImportDeclarations(source) {
	reImportDeclaration.lastIndex = 0;
	return source.replace(reImportDeclaration, parseImportDeclaration);
}

function parseDefaultValue($match, $val, $key) {
	return `module.exports = ${$val || $key || ''}`;
}

function reduceExportExpression($uri, $list, $item) {
	reAliasSep.lastIndex = 0;
	const chunk = $item.replace(reAliasSep, ',').split(',');
	if ($uri) {
		$uri = $uri.replace(opts.match, opts.replaceBy);
		if (chunk.length === 1) {
			$list[$list.length] = `exports.${chunk[0]} = require(${$uri})`;
		} else if (chunk[0] === 'default') {
			$list[$list.length] = `exports.${chunk[1]} = require(${$uri})`;
		} else {
			$list[$list.length] = `exports.${chunk[1]} = require(${$uri}).${chunk[0]}`;
		}
	} else if (chunk[0] === 'default' === false) {
		$list[$list.length] = `exports.${chunk[0]} = ${chunk[0]}`;
	}
	return $list;
}

function parseExportExpression($match, $raw, $exp, $uri) {
	const reducer = reduceExportExpression.bind(this, $uri);
	const expressions = ($exp || $raw).split(',').reduce(reducer, []);
	return expressions.join('\n');
}

function parseExportDeclaration($match, $def, $val, $key) {
	reOpeningBraceAtFirst.lastIndex = 0;
	reBraceOpeningOrCommaOrBraceClosing.lastIndex = 0;
	reExportSimply.lastIndex = 0;
	reAllWithFromExpression.lastIndex = 0;
	reAllAtFirst.lastIndex = 0;
	reWithFromExpression.lastIndex = 0;
	reFunctionAtFirst.lastIndex = 0;
	if ($def === 'default') {
		return parseDefaultValue($match, $val, $key);
	} else if (reOpeningBraceAtFirst.test($val)) {
		$val = $val.replace(reBraceOpeningOrCommaOrBraceClosing, '$1');
		return $val.replace(reWithFromExpression, parseExportExpression);
	} else if (reFunctionAtFirst.test($val)) {
		return `exports.${$key} = ${$match.replace(reExportSimply, '')}`;
	} else if (reAllAtFirst.test($val)) {
		const ctx = parseExportDeclaration;
		let uid = ctx.uid === undefined ? ctx.uid = 0 : ++ctx.uid;
		const key = `$key${uid}`;
		const val = `$val${uid}`;
		const uri = $val.replace(reAllWithFromExpression, '$1').replace(opts.match, opts.replaceBy);
		return `const ${val} = require(${uri});\nfor (const ${key} in ${val}) if (${key} === 'default' === false) exports[${key}] = ${val}[${key}]`;
	}
	return `exports.${$key}`;
}

function transformExportDeclarations($source) {
	reExportDeclaration.lastIndex = 0;
	return $source.replace(reExportDeclaration, parseExportDeclaration);
}

transform.VERSION = version;
module.exports = transform;
