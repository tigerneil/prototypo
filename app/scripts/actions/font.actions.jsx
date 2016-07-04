import XXHash from 'xxhashjs';
import slug from 'slug';

import {prototypoStore} from '../stores/creation.stores.jsx';
import LocalServer from '../stores/local-server.stores.jsx';
import LocalClient from '../stores/local-client.stores.jsx';
import {Typefaces} from '../services/typefaces.services.js';
import {copyFontValues, loadFontValues, saveAppValues} from '../helpers/loadValues.helpers.js';
import {FontValues} from '../services/values.services.js';
import {delayAfterCall} from '../helpers/animation.helpers.js';

slug.defaults.mode = 'rfc3986';
slug.defaults.modes.rfc3986.remove = /[-_\/\\\.]/g;
let localServer;
let localClient;

window.addEventListener('fluxServer.setup', () => {
	localClient = LocalClient.instance();
	localServer = LocalServer.instance;
});

const hasher = XXHash(0xDEADBEEF);

export default {
	'/create-font': (familyName) => {
		const patch = prototypoStore
			.set('fontName', familyName)
			.commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/update-font': (params) => {
		// we need a non-empty params object
		if (!params || !Object.keys(params).length) {
			return;
		}

		fontInstance.update(params);
	},
	'/change-font': async ({templateToLoad, db}) => {
		const typedataJSON = await Typefaces.getFont(templateToLoad);
		const typedata = JSON.parse(typedataJSON);

		await delayAfterCall(() => {
			const patchUi = prototypoStore.set('uiFontLoading', true).commit();
			localServer.dispatchUpdate('/prototypoStore', patchUi);
		}, 400);

		fontInstance.on('worker.fontLoaded', () => {
			setTimeout(() => {
				const patchUiEnd = prototypoStore.set('uiFontLoading', false).commit();
				localServer.dispatchUpdate('/prototypoStore', patchUiEnd);
			}, 1000);
		});

		try {
			await fontInstance.loadFont(typedata.fontinfo.familyName, typedataJSON, db);
		}
		catch (err) {
			saveErrorLog(err);
		}

		localClient.dispatchAction('/create-font', fontInstance.font.ot.getEnglishName('fontFamily'));

		localClient.dispatchAction('/load-params', {controls: typedata.controls, presets: typedata.presets});
		localClient.dispatchAction('/load-glyphs', _.mapValues(
			fontInstance.font.altMap,
			(glyph) => {
				return _.map(
					glyph,
					(alt) => {
						return {
							src: {
								tags: alt.src && alt.src.tags || [],
								characterName: alt.src && alt.src.characterName || '',
								unicode: alt.src && alt.src.unicode	|| '',
								glyphName: alt.src && alt.src.glyphName || '',
							},
							name: alt.name,
							altImg: alt.altImg,
						};
					}
				);
			}
		));
		localClient.dispatchAction('/load-tags', typedata.fontinfo.tags);

		loadFontValues(typedata, db);

	},
	'/create-family': async ({name, template, loadCurrent}) => {
		let templateToLoad = template;

		localClient.dispatchAction('/cancel-indiv-mode');
		if (loadCurrent) {
			templateToLoad = prototypoStore.get('family').template;
		}

		if (templateToLoad === undefined) {
			const patch = prototypoStore
			.set('errorAddFamily', 'You must choose a base template')
			.commit();

			localServer.dispatchUpdate('/prototypoStore', patch);
			return;
		}

		if (name === undefined || name === '') {
			const patch = prototypoStore.set('errorAddFamily', 'You must choose a name for your family').commit();

			localServer.dispatchUpdate('/prototypoStore', patch);
			return;
		}

		const fonts = Array.from(prototypoStore.get('fonts'));
		const newFont = {
			name,
			template: templateToLoad,
			variants: [
				{
					id: hasher.update(`REGULAR${(new Date()).getTime()}`).digest().toString(16),
					name: 'REGULAR',
					db: slug(`${name}regular`, ''),
				},
			],
		};

		const already = _.find(fonts, (font) => {
			return font.name === name;
		});

		if (already) {
			const patch = prototypoStore.set('errorAddFamily', 'A Family with this name already exists').commit();

			localServer.dispatchUpdate('/prototypoStore', patch);
			return;
		}

		fonts.push(newFont);

		const patch = prototypoStore
			.set('errorAddFamily', undefined)
			.commit();

		localServer.dispatchUpdate('/prototypoStore', patch);

		setTimeout(() => {
			const patchLib = prototypoStore
				.set('fonts', fonts)
				.commit();

			localServer.dispatchUpdate('/prototypoStore', patchLib);
		}, 200);

		if (loadCurrent) {
			await copyFontValues(newFont.variants[0].db);
		}

		localClient.dispatchAction('/change-font', {
			templateToLoad,
			db: newFont.variants[0].db,
		});

		const patchVariant = prototypoStore
			.set('variant', newFont.variants[0])
			.set('family', {name: newFont.name, template: newFont.template})
			.set('uiCreatefamilySelectedTemplate', undefined)
			.set('openFamilyModal', false)
			.commit();

		localServer.dispatchUpdate('/prototypoStore', patchVariant);

		saveAppValues();
	},
	'/select-variant': ({variant, family}) => {
		if (!variant) {
			variant = family.variants[0];
		}
		localClient.dispatchAction('/cancel-indiv-mode');
		const patchVariant = prototypoStore
			.set('variant', variant)
			.set('family', {name: family.name, template: family.template}).commit();

		localServer.dispatchUpdate('/prototypoStore', patchVariant);

		localClient.dispatchAction('/change-font', {
			templateToLoad: family.template,
			db: variant.db,
		});
		saveAppValues();
	},
	'/create-variant': async ({name, familyName, variantBase, noSwitch}) => {
		localClient.dispatchAction('/cancel-indiv-mode');
		const family = _.find(Array.from(prototypoStore.get('fonts') || []), (font) => {
			return font.name === familyName;
		});

		const already = _.find(family.variants, (item) => {
			return item.name === name;
		});

		if (already) {
			const patch = prototypoStore.set('errorAddVariant', 'Variant with this name already exists').commit();

			localServer.dispatchUpdate('/prototypoStore', patch);
			return;
		}

		const variant = {
			id: hasher.update(`${name}${(new Date()).getTime()}`).digest().toString(16),
			name,
			db: slug(`${familyName}${name}`, ''),
		};
		const thicknessTransform = [
			{string: 'Thin', thickness: 20},
			{string: 'Light', thickness: 50},
			{string: 'Book', thickness: 70},
			{string: 'Bold', thickness: 115},
			{string: 'Semi-Bold', thickness: 100},
			{string: 'Extra-Bold', thickness: 135},
			{string: 'Black', thickness: 150},
		];

		family.variants.push(variant);

		//TODO(franz): this is fucked up
		const patch = prototypoStore
			.set('fonts', _.cloneDeep(prototypoStore.get('fonts')))
			.set('errorAddVariant', undefined).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);

		const variantBaseDb = variantBase.db || family.variants[0].db;

		const ref = await FontValues.get({typeface: variantBaseDb});

		_.each(thicknessTransform, (item) => {
			if (name.indexOf(item.string) !== -1) {
				ref.values.thickness = item.thickness;
			}
		});

		if (name.indexOf('Italic') !== -1) {
			ref.values.slant = 10;
		}

		setTimeout(async () => {
			await FontValues.save({typeface: variant.db, values: ref.values});
			if (!noSwitch) {
				localClient.dispatchAction('/select-variant', {variant, family});
			}
		}, 200);

	},
	'/edit-variant': ({variant, family, newName}) => {
		const fonts = _.cloneDeep(prototypoStore.get('fonts') || []);
		const found = _.find(fonts, (item) => {
			return item.name === family.name;
		});
		const newVariant = _.find(found.variants || [], (item) => {
			return variant.id === item.id;
		});

		newVariant.name = newName;

		//If we modify selected variant patch selected variant.
		if (variant.id === prototypoStore.get('variant').id) {
			prototypoStore.set('variant', newVariant);
		}

		const patch = prototypoStore
			.set('fonts', fonts)
			.set('collectionSelectedVariant', newVariant)
			.set('openChangeVariantNameModal', false)
			.commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
		saveAppValues();
	},
	'/edit-family-name': ({family, newName}) => {
		const fonts = _.cloneDeep(prototypoStore.get('fonts') || []);
		const newFamily = _.find(fonts, (item) => {
			return item.name === family.name;
		});

		newFamily.name = newName;

		if (family.name === prototypoStore.get('family').name) {
			prototypoStore.set('family', newFamily);
		}

		//TODO(franz): this is fucked up
		const patch = prototypoStore
			.set('fonts', fonts)
			.set('collectionSelectedFamily', newFamily)
			.set('openChangeFamilyNameModal', false)
			.commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
		saveAppValues();
	},
	'/delete-variant': ({variant, familyName}) => {
		const family = _.find(Array.from(prototypoStore.get('fonts') || []), (item) => {
			return item.name === familyName;
		});

		_.pull(family.variants, variant);

		//TODO(franz): this is fucked up
		const patch = prototypoStore.set('fonts', prototypoStore.get('fonts')).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
		saveAppValues();

	},
	'/delete-family': ({family}) => {
		const families = _.cloneDeep(Array.from(prototypoStore.get('fonts')));

		_.remove(families, (checkee) => {
			return checkee.name === family.name && checkee.template === family.template;
		});
		const patch = prototypoStore.set('fonts', families).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);

		family.variants.forEach((variant) => {
			FontValues.deleteDb({typeface: variant.db});
		});

		saveAppValues();
	},
	'/clear-error-family': () => {
		const patch = prototypoStore.set('errorAddFamily', undefined).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/clear-error-variant': () => {
		const patch = prototypoStore.set('errorAddVariant', undefined).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/select-family-collection': (family) => {
		const patch = prototypoStore
			.set('collectionSelectedFamily', family)
			.set('collectionSelectedVariant', undefined)
			.commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/select-variant-collection': (variant) => {
		const patch = prototypoStore.set('collectionSelectedVariant', variant).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/close-create-family-modal': () => {
		const patch = prototypoStore.set('openFamilyModal', false).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/close-create-variant-modal': () => {
		const patch = prototypoStore.set('openVariantModal', false).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
};
