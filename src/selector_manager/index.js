/**
 * Selectors in GrapesJS are used in CSS Composer inside Rules and in Components as classes. To illustrate this concept let's take
 * a look at this code:
 *
 * ```css
 * span > #send-btn.btn{
 *  ...
 * }
 * ```
 * ```html
 * <span>
 *   <button id="send-btn" class="btn"></button>
 * </span>
 * ```
 *
 * In this scenario we get:
 * * span     -> selector of type `tag`
 * * send-btn -> selector of type `id`
 * * btn      -> selector of type `class`
 *
 * So, for example, being `btn` the same class entity it'll be easier to refactor and track things.
 *
 * You can customize the initial state of the module from the editor initialization, by passing the following [Configuration Object](https://github.com/artf/grapesjs/blob/master/src/selector_manager/config/config.js)
 * ```js
 * const editor = grapesjs.init({
 *  selectorManager: {
 *    // options
 *  }
 * })
 * ```
 *
 * Once the editor is instantiated you can use its API and listen to its events. Before using these methods, you should get the module from the instance.
 *
 * ```js
 * // Listen to events
 * editor.on('selector:add', (selector) => { ... });
 *
 * // Use the API
 * const sm = editor.Selectors;
 * sm.add(...);
 * ```
 *
 * ## Available Events
 * * `selector:add` - Selector added. The [Selector] is passed as an argument to the callback.
 * * `selector:remove` - Selector removed. The [Selector] is passed as an argument to the callback.
 * * `selector:update` - Selector updated. The [Selector] and the object containing changes are passed as arguments to the callback.
 * * `selector:state` - State changed. Passes the new state value as an argument.
 * * `selector` - Catch-all event for all the events mentioned above. An object containing all the available data about the triggered event is passed as an argument to the callback.
 *
 * ## Methods
 * * [getConfig](#getconfig)
 * * [add](#add)
 * * [get](#get)
 * * [remove](#remove)
 * * [getAll](#getall)
 * * [setState](#setstate)
 * * [getState](#getstate)
 *
 * [Selector]: selector.html
 *
 * @module SelectorManager
 */

import { isString, debounce, isObject, isArray, isEmpty } from 'underscore';
import { isComponent, isRule } from 'utils/mixins';
import { Model } from 'common';
import Module from 'common/module';
import defaults from './config/config';
import Selector from './model/Selector';
import Selectors from './model/Selectors';
import ClassTagsView from './view/ClassTagsView';

const isId = str => isString(str) && str[0] == '#';
const isClass = str => isString(str) && str[0] == '.';

export const evAll = 'selector';
export const evPfx = `${evAll}:`;
export const evAdd = `${evPfx}add`;
export const evUpdate = `${evPfx}update`;
export const evRemove = `${evPfx}remove`;
export const evRemoveBefore = `${evRemove}:before`;
export const evCustom = `${evPfx}custom`;

export default () => {
  return {
    ...Module,

    name: 'SelectorManager',

    Selector,

    Selectors,

    events: {
      all: evAll,
      update: evUpdate,
      add: evAdd,
      remove: evRemove,
      removeBefore: evRemoveBefore,
      custom: evCustom
    },

    /**
     * Get configuration object
     * @name getConfig
     * @function
     * @return {Object}
     */

    init(conf = {}) {
      this.__initConfig(defaults, conf);
      const config = this.getConfig();
      const em = config.em;
      const ppfx = config.pStylePrefix;

      if (ppfx) {
        config.stylePrefix = ppfx + config.stylePrefix;
      }

      // Global selectors container
      this.all = new Selectors(config.selectors);
      this.selected = new Selectors([], { em, config });
      this.model = new Model({ cFirst: config.componentFirst, _undo: true });
      this.__initListen();
      em.on('change:state', (m, value) => em.trigger('selector:state', value));
      this.model.on('change:cFirst', (m, value) =>
        em.trigger('selector:type', value)
      );
      const listenTo =
        'component:toggled component:update:classes styleManager:update change:state selector:type';
      this.model.listenTo(em, listenTo, () => this.__update());

      return this;
    },

    __update: debounce(function() {
      this.__trgCustom();
    }),

    __trgCustom() {
      this.em.trigger(this.events.custom, this.__customData());
    },

    __customData() {
      const common = this.__getCommon();
      return {
        sm: this,
        common,
        states: this.getStates(),
        selected: this.getSelected(),
        add: prop => this.__addToCommon(prop), // add selector to common selection
        remove: '' // remove selector from selection
      };
    },

    // postLoad() {
    //   this.__postLoad();
    //   const { em, model } = this;
    //   const um = em.get('UndoManager');
    //   um && um.add(model);
    //   um && um.add(this.pages);
    // },

    postRender() {
      this.__appendTo();
      this.__trgCustom();
    },

    select(value, opts = {}) {
      const targets = Array.isArray(value) ? value : [value];
      const toSelect = this.em.get('StyleManager').setTarget(targets, opts);
      const selTags = this.selectorTags;
      const res = toSelect
        .filter(i => i)
        .map(sel =>
          isComponent(sel)
            ? sel
            : isRule(sel) && !sel.get('selectorsAdd')
            ? sel
            : sel.getSelectorsString()
        );
      selTags && selTags.componentChanged({ targets: res });
      return this;
    },

    getSelected() {
      return this.em.get('StyleManager').getTargets();
    },

    addSelector(name, opts = {}, cOpts = {}) {
      let props = { ...opts };

      if (isObject(name)) {
        props = name;
      } else {
        props.name = name;
      }

      if (isId(props.name)) {
        props.name = props.name.substr(1);
        props.type = Selector.TYPE_ID;
      } else if (isClass(props.name)) {
        props.name = props.name.substr(1);
      }

      if (props.label && !props.name) {
        props.name = this.escapeName(props.label);
      }

      const cname = props.name;
      const config = this.getConfig();
      const all = this.getAll();
      const selector = cname
        ? this.get(cname, props.type)
        : all.where(props)[0];

      if (!selector) {
        return all.add(props, { ...cOpts, config });
      }

      return selector;
    },

    getSelector(name, type = Selector.TYPE_CLASS) {
      if (isId(name)) {
        name = name.substr(1);
        type = Selector.TYPE_ID;
      } else if (isClass(name)) {
        name = name.substr(1);
      }

      return this.getAll().where({ name, type })[0];
    },

    /**
     * Add a new selector to the collection if it does not already exist.
     * You can pass selectors properties or string identifiers.
     * @param {Object|String} props Selector properties or string identifiers, eg. `{ name: 'my-class', label: 'My class' }`, `.my-cls`
     * @param {Object} [opts] Selector options
     * @return {[Selector]}
     * @example
     * const selector = selectorManager.add({ name: 'my-class', label: 'My class' });
     * console.log(selector.toString()) // `.my-class`
     * // Same as
     * const selector = selectorManager.add('.my-class');
     * console.log(selector.toString()) // `.my-class`
     * */
    add(props, opts = {}) {
      const cOpts = isString(props) ? {} : opts;
      // Keep support for arrays but avoid it in docs
      if (isArray(props)) {
        return props.map(item => this.addSelector(item, opts, cOpts));
      } else {
        return this.addSelector(props, opts, cOpts);
      }
    },

    /**
     * Add class selectors
     * @param {Array|string} classes Array or string of classes
     * @return {Array} Array of added selectors
     * @private
     * @example
     * sm.addClass('class1');
     * sm.addClass('class1 class2');
     * sm.addClass(['class1', 'class2']);
     * // -> [SelectorObject, ...]
     */
    addClass(classes) {
      const added = [];

      if (isString(classes)) {
        classes = classes.trim().split(' ');
      }

      classes.forEach(name => added.push(this.addSelector(name)));
      return added;
    },

    /**
     * Get the selector by its name/type
     * @param {String} name Selector name or string identifier
     * @returns {[Selector]|null}
     * @example
     * const selector = selectorManager.get('.my-class');
     * // Get Id
     * const selectorId = selectorManager.get('#my-id');
     * */
    get(name, type) {
      // Keep support for arrays but avoid it in docs
      if (isArray(name)) {
        const result = [];
        const selectors = name
          .map(item => this.getSelector(item))
          .filter(item => item);
        selectors.forEach(
          item => result.indexOf(item) < 0 && result.push(item)
        );
        return result;
      } else {
        return this.getSelector(name, type) || null;
      }
    },

    /**
     * Remove Selector.
     * @param {String|[Selector]} selector Selector instance or Selector string identifier
     * @returns {[Selector]} Removed Selector
     * @example
     * const removed = selectorManager.remove('.myclass');
     * // or by passing the Selector
     * selectorManager.remove(selectorManager.get('.myclass'));
     */
    remove(selector, opts) {
      return this.__remove(selector, opts);
    },

    /**
     * Change the selector state
     * @param {String} value State value
     * @returns {this}
     * @example
     * selectorManager.setState('hover');
     */
    setState(value) {
      this.em.setState(value);
      return this;
    },

    /**
     * Get the current selector state value
     * @returns {String}
     */
    getState() {
      return this.em.getState();
    },

    /**
     * Get states
     * @returns {Array<State>}
     * @private
     */
    getStates() {
      return this.config.states;
    },

    /**
     * Get all selectors
     * @name getAll
     * @function
     * @return {Collection<[Selector]>}
     * */

    /**
     * Return escaped selector name
     * @param {String} name Selector name to escape
     * @returns {String} Escaped name
     * @private
     */
    escapeName(name) {
      const { escapeName } = this.getConfig();
      return escapeName ? escapeName(name) : Selector.escapeName(name);
    },

    /**
     * Render class selectors. If an array of selectors is provided a new instance of the collection will be rendered
     * @param {Array<Object>} selectors
     * @return {HTMLElement}
     * @private
     */
    render(selectors) {
      const { em, selectorTags } = this;
      const config = this.getConfig();
      const el = selectorTags && selectorTags.el;
      this.selected.reset(selectors);
      this.selectorTags = new ClassTagsView({
        el,
        collection: this.selected,
        module: this,
        config
      });

      return this.selectorTags.render().el;
    },

    destroy() {
      const { selectorTags, model } = this;
      const all = this.getAll();
      model.stopListening();
      all.stopListening();
      all.reset();
      selectorTags && selectorTags.remove();
      this.em = {};
      this.selectorTags = {};
    },

    // __toSync(common = []) {
    //   const cmpFirst = this.getConfig().componentFirst;
    //   const cmp = this.em.getSelected();
    //   let result = null;

    //   if (cmp && cmpFirst && common.length) {
    //     const style = cmp.getStyle();
    //     result = !isEmpty(style) ? style : null;
    //   }

    //   return result;
    // },

    /**
     * Get common selectors from the current selection.
     * @return {Array<Selector>}
     * @private
     */
    __getCommon() {
      return this.__getCommonSelectors(this.em.getSelectedAll());
    },

    __getCommonSelectors(components, opts = {}) {
      const selectors = components
        .map(cmp => cmp.getSelectors && cmp.getSelectors().getValid(opts))
        .filter(Boolean);
      return this.__common(...selectors);
    },

    __common(...args) {
      if (!args.length) return [];
      if (args.length === 1) return args[0];
      if (args.length === 2)
        return args[0].filter(item => args[1].indexOf(item) >= 0);

      return args
        .slice(1)
        .reduce((acc, item) => this.__common(acc, item), args[0]);
    },

    getSelected() {
      return [...this.selected.models];
    },

    addSelected(props) {
      const added = this.add(props);
      // TODO: target should be the one from StyleManager
      this.em.getSelectedAll().forEach(target => {
        target.getSelectors().add(added);
      });
      // TODO: update selected collection
    },

    removeSelected(selector) {
      this.em.getSelectedAll().forEach(trg => {
        !selector.get('protected') &&
          trg &&
          trg.getSelectors().remove(selector);
      });
    },

    getComponentFirst() {
      return this.getConfig().componentFirst;
    },

    setComponentFirst(value) {
      this.getConfig().componentFirst = value;
      this.model.set({ cFirst: value });
    }
  };
};
