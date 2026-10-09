import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(process.env.HOMER_ISOLATED_RELEASE==='1'?{out:'fixture-data/homer-release-build/server'}:{}),
        ...(process.env.HOMER_ISOLATED_RELEASE==='1'?{files:{routes:'src/homer-routes'}}:{})
	}
};

export default config;
