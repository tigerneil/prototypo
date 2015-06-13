import React from 'react';
import Topbar from './topbar.components.jsx';
import GlyphPanel from './glyph-panel.components.jsx';
import PrototypoPanel from './prototypo-panel.components.jsx';
import Lifespan from 'lifespan';
import LocalClient from '../stores/local-client.stores.jsx';

export default class Workboard extends React.Component {

	constructor(props) {
		super(props);
		this.state = {};
	}

	componentWillMount() {
		this.lifespan = new Lifespan();
		this.client = new LocalClient().instance;


		const fontStore = this.client.fetch('/fontStore');
		this.setState({
			fontName: fontStore.get('fontName'),
			glyphs: fontStore.get('glyphs'),
		});

		this.client.getStore('/fontStore', this.lifespan)
			.onUpdate(({head}) => {
				this.setState(head.toJS());
			})
			.onDelete(() => {
				this.setState(undefined);
			});
	}

	componentWillUnmount() {
		this.lifespan.release();
	}

	render() {
		return (
			<div id="workboard">
				<Topbar />
				<PrototypoPanel fontName={this.state.fontName} glyphs={this.state.glyphs}/>
				<GlyphPanel />
			</div>
		)
	}
}