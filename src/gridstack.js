//     gridstack.js 0.2.4-dev
//     http://troolee.github.io/gridstack.js/
//     (c) 2014-2015 Pavel Reznikov
//     gridstack.js may be freely distributed under the MIT license.

(function(factory) {
    if (typeof define === 'function' && define.amd) {
        define(['jquery', 'lodash', 'jquery-ui/core', 'jquery-ui/widget', 'jquery-ui/mouse', 'jquery-ui/draggable',
            'jquery-ui/resizable'], factory);
    }
    else if (typeof exports !== 'undefined') {
      try { jQuery = require('jquery'); } catch(e) {}
      try { _ = require('lodash'); } catch(e) {}
      factory(jQuery, _);
    }
    else {
        factory(jQuery, _);
    }
})(function($, _) {

    var scope = window;

    var Utils = {
        is_intercepted: function(a, b, threshold) {
            if (!threshold) {
              threshold = 0;
            }
            return !(a.x + (a.width * (1-threshold)) <= b.x ||
                     b.x + (b.width * (1-threshold)) <= a.x ||
                     a.y + (a.height * (1-threshold)) <= b.y ||
                     b.y + (b.height * (1-threshold)) <= a.y);
        },

        sort: function(nodes, dir, width) {
            width = width || _.chain(nodes).map(function(node) { return node.x + node.width; }).max().value();
            dir = dir != -1 ? 1 : -1;
            return _.sortBy(nodes, function(n) { return dir * (n.x + n.y * width); });
        },

        create_stylesheet: function(id) {
            var style = document.createElement('style');
            style.setAttribute('type', 'text/css');
            style.setAttribute('data-gs-id', id);
            if (style.styleSheet) {
                style.styleSheet.cssText = '';
            }
            else {
                style.appendChild(document.createTextNode(''));
            }
            document.getElementsByTagName('head')[0].appendChild(style);
            return style.sheet;
        },
        remove_stylesheet: function(id) {
            $("STYLE[data-gs-id=" + id +"]").remove();
        },
        insert_css_rule: function(sheet, selector, rules, index) {
            if (typeof sheet.insertRule === 'function') {
                sheet.insertRule(selector + '{' + rules + '}', index);
            }
            else if (typeof sheet.addRule === 'function') {
                sheet.addRule(selector, rules, index);
            }
        },

        toBool: function(v) {
            if (typeof v == 'boolean')
                return v;
            if (typeof v == 'string') {
                v = v.toLowerCase();
                return !(v == '' || v == 'no' || v == 'false' || v == '0');
            }
            return Boolean(v);
        }
    };

    var id_seq = 0;

    var GridStackEngine = function(opts) {
        this.opts = opts;

        this.width = opts.width;
        this.float = opts.float || false;
        this.height = opts.height || 0;
        this.minimize_height = opts.minimize_height;

        this.nodes = opts.items || [];
        this.onchange = opts.onchange || function() {};

        this._update_counter = 0;
        this._original_float = this.float;
    };

    GridStackEngine.prototype.batch_update = function() {
        this._update_counter = 1;
        this.float = true;
    };

    GridStackEngine.prototype.commit = function() {
        this._update_counter = 0;
        if (this._update_counter == 0) {
            this.float = this._original_float;
            this._pack_nodes();
            this._notify();
        }
    };

    GridStackEngine.prototype._fix_collisions = function(node) {
        this._sort_nodes(-1);

        var nn = node, has_locked = Boolean(_.find(this.nodes, function(n) { return n.locked }));
        if (!this.float && !has_locked) {
            nn = {x: 0, y: node.y, width: this.width, height: node.height};
        }

        while (true) {
            var collision_node = _.find(this.nodes, function(n) {
                return n != node && Utils.is_intercepted(n, nn);
            }, this);

            if (typeof collision_node == 'undefined') {
                return;
            }

            var node_moved = this.move_node(collision_node, collision_node.x, node.y + node.height,
                collision_node.width, collision_node.height, true);

            // var node_moved = this.move_node(collision_node, collision_node.x, node.y - collision_node.height,
            //     collision_node.width, collision_node.height, true);
            // if `node` is more than half way down the collision_node, try moving collision_node up

            if (!node_moved) {
                this.move_node(collision_node, collision_node.x, node.y + node.height,
                    collision_node.width, +collision_node.min_height);
            }
        }
    };

    GridStackEngine.prototype.is_area_empty = function(x, y, width, height) {
        var nn = {x: x || 0, y: y || 0, width: width || 1, height: height || 1};
        var collision_node = _.find(this.nodes, function(n) {
            return Utils.is_intercepted(n, nn);
        }, this);
        return collision_node == null;
    };

    GridStackEngine.prototype._sort_nodes = function(dir) {
        this.nodes = Utils.sort(this.nodes, dir, this.width);
    };

    GridStackEngine.prototype._pack_nodes = function() {
        this._sort_nodes();

        if (this.float) {
            _.each(this.nodes, function(n, i) {
                if (n._updating || typeof n._orig_y == 'undefined' || n.y == n._orig_y)
                    return;

                var new_y = n.y;
                while (new_y >= n._orig_y) {
                    var collision_node = _.chain(this.nodes)
                        .find(function(bn) {
                            return n != bn &&
                                Utils.is_intercepted({x: n.x, y: new_y, width: n.width, height: n.height}, bn);
                        })
                        .value();

                    if (!collision_node) {
                        n._dirty = true;
                        n.y = new_y;
                    }
                    --new_y;
                }
            }, this);
        }
        else {
            _.each(this.nodes, function(n, i) {
                if (n.locked)
                    return;
                while (n.y > 0) {
                    var new_y = n.y - 1;
                    var can_be_moved = i == 0;

                    if (i > 0) {
                        var collision_node = _.chain(this.nodes)
                            .take(i)
                            .find(function(bn) {
                                return Utils.is_intercepted({x: n.x, y: new_y, width: n.width, height: n.height}, bn);
                            })
                            .value();
                        can_be_moved = typeof collision_node == 'undefined';
                    }

                    if (!can_be_moved) {
                        break;
                    }
                    n._dirty = n.y != new_y;
                    n.y = new_y;
                }
            }, this);
        }
    };

    GridStackEngine.prototype._prepare_node = function(node, resizing) {
        node = _.defaults(node || {}, {width: 1, height: 1, x: 0, y: 0 });

        node.x = parseInt('' + node.x, 10);
        node.y = parseInt('' + node.y, 10);
        node.width = parseInt('' + node.width, 10);
        node.height = parseInt('' + node.height, 10);
        node.auto_position = node.auto_position || false;
        node.no_resize = node.no_resize || false;
        node.no_move = node.no_move || false;

        if (node.width > this.width) {
            node.width = this.width;
        }
        else if (node.width < 1) {
            node.width = 1;
        }

        if (node.height < 1) {
            node.height = 1;
        }

        if (node.x < 0) {
            node.x = 0;
        }

        if (node.x + node.width > this.width) {
            if (resizing) {
                node.width = this.width - node.x;
            }
            else {
                node.x = this.width - node.width;
            }
        }

        if (node.y < 0) {
            node.y = 0;
        }

        return node;
    };

    GridStackEngine.prototype._notify = function() {
        if (this._update_counter) {
            return;
        }
        var deleted_nodes = Array.prototype.slice.call(arguments, 1).concat(this.get_dirty_nodes());
        deleted_nodes = deleted_nodes.concat(this.get_dirty_nodes());
        this.onchange(deleted_nodes);
    };

    GridStackEngine.prototype.clean_nodes = function() {
        _.each(this.nodes, function(n) {n._dirty = false });
    };

    GridStackEngine.prototype.get_dirty_nodes = function() {
        return _.filter(this.nodes, function(n) { return n._dirty; });
    };

    GridStackEngine.prototype.add_node = function(node) {
        node = this._prepare_node(node);

        if (typeof node.max_width != 'undefined') node.width = Math.min(node.width, node.max_width);
        if (typeof node.max_height != 'undefined') node.height = Math.min(node.height, node.max_height);
        if (typeof node.min_width != 'undefined') node.width = Math.max(node.width, node.min_width);
        if (typeof node.min_height != 'undefined') node.height = Math.max(node.height, node.min_height);

        node._id = ++id_seq;
        node._dirty = true;

        if (node.auto_position) {
            this._sort_nodes();

            for (var i = 0;; ++i) {
                var x = i % this.width, y = Math.floor(i / this.width);
                if (x + node.width > this.width) {
                    continue;
                }
                if (!_.find(this.nodes, function(n) {
                    return Utils.is_intercepted({x: x, y: y, width: node.width, height: node.height}, n);
                })) {
                    node.x = x;
                    node.y = y;
                    break;
                }
            }
        }

        this.nodes.push(node);

        this._fix_collisions(node);
        this._pack_nodes();
        this._notify();
        return node;
    };

    GridStackEngine.prototype.remove_node = function(node) {
        node._id = null;
        this.nodes = _.without(this.nodes, node);
        this._pack_nodes();
        this._notify(node);
    };

    GridStackEngine.prototype.can_move_node = function(node, x, y, width, height) {
        var has_locked = _.any(this.nodes, function(n) { return n.locked });

        if (!this.height && !has_locked) {
            return true;
        }

        var clone = this.clone(node);
        var cloned_node = clone.target_node;

        clone.move_node(cloned_node, x, y, width, height);

        var res = true;

        if (has_locked) {
            res &= !_.any(clone.nodes, function(n) {
                return n != cloned_node && Boolean(n.locked) && Boolean(n._dirty);
            });
        }

        if (this.height && !this.make_room) {
            res &= clone.get_grid_height() <= this.height;
        }

        return res;
    };

    GridStackEngine.prototype.can_be_placed_with_respect_to_height = function(node) {
        if (!this.height || this.make_room) {
            return true;
        }

        var clone = this.clone();
        clone.add_node(node);
        return clone.get_grid_height() <= this.height;
    };

    GridStackEngine.prototype.move_node = function(node, x, y, width, height, no_pack) {
        if (typeof x != 'number') x = node.x;
        if (typeof y != 'number') y = node.y;
        if (typeof width != 'number') width = node.width;
        if (typeof height != 'number') height = node.height;

        if (typeof node.max_width != 'undefined') width = Math.min(width, node.max_width);
        if (typeof node.max_height != 'undefined') height = Math.min(height, node.max_height);
        if (typeof node.min_width != 'undefined') width = Math.max(width, node.min_width);
        if (typeof node.min_height != 'undefined') height = (node.minimized ? this.minimize_height : Math.max(height, node.min_height));

        // if (node.el.attr('data-gs-x') == x &&
        //     node.el.attr('data-gs-y') == y &&
        //     node.el.attr('data-gs-width') == width &&
        //     node.el.attr('data-gs-height') == height) {
        //     return false;
        // }

        if (node.x == x &&
            node.y == y &&
            node.width == width &&
            node.height == height) {
            return false;
        }

        var resizing = node.width != width;
        node._dirty = true;

        node.x = x;
        node.y = y;
        node.width = width;
        node.height = height;

        node = this._prepare_node(node, resizing);

        this._fix_collisions(node);
        if (!no_pack) {
            this._pack_nodes();
            this._notify();
        }
        return node;
    };

    GridStackEngine.prototype.get_grid_height = function() {
        return _.reduce(this.nodes, function(memo, n) { return Math.max(memo, n.y + n.height); }, 0);
    };

    GridStackEngine.prototype.grid_is_too_tall = function() {
        return this.get_grid_height() > this.height;
    };

    GridStackEngine.prototype.get_nodes_by_column = function() {
        var columns = [];

        var nodes_by_column = this.nodes
            .forEach(function(node, idx) {
                for (var i = 0; i < node.width; i++) {
                    var col = node.x + i;
                    columns[col] = columns[col] || [];
                    columns[col].push(node);
                }

            });

        columns.forEach(function(column) {
            column.sort(function(node_a, node_b) {
                return node_a.y - node_b.y;
            });
        });

        return columns;
    };

    GridStackEngine.prototype.get_column_by_x = function(x) {
        var columns = this.get_nodes_by_column();
        return columns[x];
    };

    GridStackEngine.prototype.get_columns_for_node = function(node) {
        var columns = this.get_nodes_by_column();
        return columns
            .filter(function(column) {
                return column.indexOf(node) > -1;
            });
    };

    GridStackEngine.prototype.get_node_by_coords = function(x, y) {
        var selected_column = this.get_column_by_x(x);
        if (selected_column) {
            var target_node = selected_column
                .find(function(node) { return node.y == y; });
            return target_node;
        }
    };

    GridStackEngine.prototype.column_overflows = function(column) {
        var column_height = _(column).map(function(node) {
            return node.y + node.height;
        }).max();
        return column_height > this.height;
    };

    GridStackEngine.prototype.can_shrink_column = function(column) {

        // are any of the nodes taller than their minimum heights?
        var can_shrink_nodes = _(column).any(function(node) {
            var min_height = parseInt(node.min_height, 10)
            return (min_height && node.height > min_height);
        });


        // is there any whitespace between the nodes that could be collapsed?
        var can_close_whitespace;

        if (column.length == 1) {
            can_close_whitespace = can_shrink_nodes;
        } else {
            for (var i = column.length-1; i >= 0; i--) {

            var node_a = column[i-1],
                node_b = column[i];

                if (i == 0) {
                    if (node_b.y > 0) {
                        can_close_whitespace = true;
                    }
                    break;
                }

                if (node_b) {
                    var node_a_y_bottom = node_a.y + node_a.height + 3;
                    if (node_a_y_bottom < node_b.y) {
                        can_close_whitespace = true;
                        break;
                    }
                }
            }

        }

        return can_shrink_nodes || can_close_whitespace;
    };

    GridStackEngine.prototype.fit_to_height = function() {
        var self = this,
            everything_fits = true;

        // first try shrinking the columns
        if (this.grid_is_too_tall()) {
            var columns = this.get_nodes_by_column();
            columns.forEach(function(column) {
                if (self.column_overflows(column)) {
                    self.shrink_column(column);
                }
            });
        }

        // then try pushing tiles onto subsequent columns
        // if (this.grid_is_too_tall()) {
        //
        // }

        return !this.grid_is_too_tall();
    };

    GridStackEngine.prototype.shrink_column = function(column) {
        var self = this;
        var canBreak = function(column) {
            return !self.column_overflows(column) || !self.can_shrink_column(column);
        };

        var moveY = function(node, offset) {
            self.move_node(node, node.x, node.y+offset, node.width, node.height);
        };

        var shrinkHeight = function(node, offset) {
            self.move_node(node, node.x, node.y, node.width, node.height+offset);
        };

        if (!this.grid_is_too_tall()) {
            return;
        }

        while (!canBreak(column)) {
            // try whitespace
            for (var i = column.length-1; i >= 0; i--) {

                if (canBreak(column)) {
                    break;
                }

                var node_a = column[i-1],
                    node_b = column[i];

                if (i == 0) {
                    if (node_b.y > 0) {
                        moveY(node_b, -3);
                    }
                    break;
                }

                if (node_b) {
                    var node_a_y_bottom = node_a.y + node_a.height + 3;
                    if (node_a_y_bottom < node_b.y) {
                        moveY(node_b, -3);
                        break;
                    }
                }
            }

            // try shrinking nodes
            for (var i = column.length-1; i >= 0; i--) {

                if (canBreak(column)) {
                    break;
                }

                var node = column[i];
                if (node) {
                    if (node.height > node.min_height) {
                        shrinkHeight(node, -3);
                        break;
                    }
                }
            }
        }
    };

    GridStackEngine.prototype.focus_on_node_at = function(x, y, minimize_others) {
        var target_node = this.get_node_by_coords(x, y);
        var columns = this.get_columns_for_node(target_node);
        var self = this;

        if (minimize_others) {
            columns.forEach(function(column) {
                column.forEach(function(node) {
                    if (node != target_node) {
                        self.minimize_node(node);
                    }
                });
            });
        }

        this.expand_node(target_node, minimize_others);
        this.fit_to_height();

        // columns.forEach(function(column) {
       //     nodes.forEach(function(node) {
       //         // st
       //         for (var i = 0; i < column.length; i--) {
       //             var node_a = column[i],
       //                 node_b = column[i+1];
       //
       //             if (i == 0 && node_a.y > 0) {
       //                 self.move_node(node_a, node.x, 0, node.width, node.height);
       //             }
       //
       //             if (node_b) {
       //                 // if (node_b == target_node) {
       //                 var target_y = node_a.y + node_a.height + 3;
       //                 if (node_b.y > target_y) {
       //                     self.move_node(node_b, node.x, target_y, node.width, node.height);
       //                 }
       //
       //                 if (node_a == target_node) {
       //                     self.move_node(node_a, )
       //                 }
       //                 // } else {
       //
       //                 // }
       //
       //                 var node_a_y_bottom = node_a.y + node_a.height + 3;
       //                 if (node_a_y_bottom < node_b.y) {
       //                     moveY(node_b, -3);
       //                     break;
       //                 }
       //             }
       //         }
       //     });
       //  });
    };

    GridStackEngine.prototype.minimize_node_at = function(x, y) {
        var target_node = this.get_node_by_coords(x, y);
        this.minimize_node(target_node);
    };

    GridStackEngine.prototype.minimize_node = function(node) {
        node.el.attr('data-gs-minimized', true);
        node.minimized = true;

        node.expanded_height = node.height;
        node.expanded_min_height = node.min_height;

        var minimize_height = this.minimize_height;
        node.el.attr('data-gs-min-height', minimize_height);
        node.min_height = minimize_height;

        this.move_node(node, node.x, node.y, node.width, node.min_height);
    };

    GridStackEngine.prototype.expand_node = function(node, maximize) {
        var new_height;
        var minimized_attr = node.el.attr('data-gs-minimized');
        var is_minimized = node.minimized || minimized_attr == 'true';

        if (is_minimized) {
            node.el.attr('data-gs-minimized', false);
            delete node.minimized;

            new_height = node.expanded_height;
            delete node.expanded_height;

            node.min_height = node.expanded_min_height;
            delete node.expanded_min_height;
            node.el.attr('data-gs-min-height', node.min_height);
        }

        if (maximize) {
            new_height = this.height;
        }

        this.move_node(node, node.x, node.y, node.width, new_height);
    };

    GridStackEngine.prototype.begin_update = function(node) {
        _.each(this.nodes, function(n) {
            n._orig_y = n.y;
        });
        node._updating = true;
    };

    GridStackEngine.prototype.end_update = function() {
        _.each(this.nodes, function(n) {
            n._orig_y = n.y;
        });
        var n = _.find(this.nodes, function(n) { return n._updating; });
        if (n) {
            n._updating = false;
        }
    };

    GridStackEngine.prototype.clone = function(target_node) {
        var cloned_node;
        var opts = {
            width: this.width,
            float: this.float,
            height: this.height,
            items: _.map(this.nodes, function(node) {
                if (target_node && node == target_node) {
                    cloned_node = $.extend({}, target_node);
                    return cloned_node;
                } else {
                    return $.extend({}, node);
                }
            }),
            onchange: null,
            minimize_height: this.minimize_height
        };

        var clone = new GridStackEngine(opts);

        clone.target_node = cloned_node;

        return clone;
    };

    var GridStack = function(el, opts) {
        var self = this, one_column_mode;
        this.container = $(el);
        this.opts = this._process_options(opts);

        this.container.addClass(this.opts._class);

        this._set_static_class();

        if (this.opts.is_nested) {
            this.container.addClass('grid-stack-nested');
        }

        this._init_styles();

        var gridOpts = {
            width: this.opts.width,
            float: this.opts.float,
            height: this.opts.height,
            minimize_height: this.opts.minimize_height,
            onchange: function(nodes) {
                var max_height = 0;
                _.each(nodes, function(n) {
                    if (n._id == null) {
                        n.el.remove();
                    }
                    else {
                        n.el
                            .attr('data-gs-x', n.x)
                            .attr('data-gs-y', n.y)
                            .attr('data-gs-width', n.width)
                            .attr('data-gs-height', n.height)
                            .attr('data-gs-minimized', (["true", true].indexOf(n.minimized) > -1));
                        max_height = Math.max(max_height, n.y + n.height);
                    }
                });
                self._update_styles(max_height + 10);
            }
        };

        this.grid = new GridStackEngine(gridOpts);

        if (this.opts.auto) {
            var elements = [];
            var _this = this;
            this.container.children('.' + this.opts.item_class + ':not(.' + this.opts.placeholder_class + ')').each(function(index, el) {
                el = $(el);
                elements.push({
                    el: el,
                    i: parseInt(el.attr('data-gs-x')) + parseInt(el.attr('data-gs-y')) * _this.opts.width
                });
            });
            _.chain(elements).sortBy(function(x) { return x.i; }).each(function(i) {
                self._prepare_element(i.el);
            }).value();
        }

        this.set_animation(this.opts.animate);

        this.placeholder = $(
            '<div class="' + this.opts.placeholder_class + ' ' + this.opts.item_class + '">' +
            '<div class="placeholder-content" /></div>').hide();

        this.container.height(
            this.grid.get_grid_height() * (this.opts.cell_height + this.opts.vertical_margin) -
            this.opts.vertical_margin);

        this.on_resize_handler = function() {
            if (self._is_one_column_mode()) {
                if (one_column_mode)
                    return;

                one_column_mode = true;

                self.grid._sort_nodes();
                _.each(self.grid.nodes, function(node) {
                    self.container.append(node.el);

                    if (self.opts.static_grid) {
                        return;
                    }
                    if (!node.no_move) {
                        node.el.draggable('disable');
                    }
                    if (!node.no_resize) {
                        node.el.resizable('disable');
                    }
                });
            }
            else {
                if (!one_column_mode)
                    return;

                one_column_mode = false;

                if (self.opts.static_grid) {
                    return;
                }

                _.each(self.grid.nodes, function(node) {
                    if (!node.no_move) {
                        node.el.draggable('enable');
                    }
                    if (!node.no_resize) {
                        node.el.resizable('enable');
                    }
                });
            }
        };

        $(window).resize(this.on_resize_handler);
        this.on_resize_handler();
    };

    GridStack.prototype._process_options = function(opts) {
        opts = opts || {};

        var defaults = {
            width: parseInt(this.container.attr('data-gs-width')) || 12,
            height: parseInt(this.container.attr('data-gs-height')) || 0,
            primary_axis: 'y',
            item_class: 'grid-stack-item',
            placeholder_class: 'grid-stack-placeholder',
            handle: '.grid-stack-item-content',
            handle_class: null,
            cell_height: 60,
            vertical_margin: 20,
            minimize_height: 3,
            auto: true,
            min_width: 768,
            float: false,
            static_grid: false,
            _class: 'grid-stack-' + (Math.random() * 10000).toFixed(0),
            animate: Boolean(this.container.attr('data-gs-animate')) || false,
            always_show_resize_handle: false,
            static_class: 'grid-stack-static',
            y_fit_increment: 1,
            can_expand_x: true,
            make_room_on_drag: false,
            drag_delay: 100
        };

        opts = _.defaults(opts, defaults);
        opts.is_nested = this.container.closest('.' + opts.item_class).size() > 0;

        opts.resizable = _.defaults(opts.resizable || {}, {
            autoHide: !(opts.always_show_resize_handle || false),
            handles: 'se'
        });

        opts.draggable = _.defaults(opts.draggable || {}, {
            handle: (opts.handle_class ? '.' + opts.handle_class : (opts.handle ? opts.handle : '')) || '.grid-stack-item-content',
            scroll: false,
            appendTo: 'body'
        });

        return opts;

    };

    GridStack.prototype._trigger_change_event = function(forceTrigger) {
        var elements = this.grid.get_dirty_nodes();
        var hasChanges = false;

        var eventParams = [];
        if (elements && elements.length) {
            elements.forEach(function(element) {
                element.el.trigger('change');
            });

            eventParams.push(elements);
            hasChanges = true;
        }

        if (hasChanges || forceTrigger === true) {
            this.container.trigger('change', eventParams);
        }
    };

    GridStack.prototype._init_styles = function() {
        if (this._styles_id) {
            $('[data-gs-id="' + this._styles_id + '"]').remove();
        }
        this._styles_id = 'gridstack-style-' + (Math.random() * 100000).toFixed();
        this._styles = Utils.create_stylesheet(this._styles_id);
        if (this._styles != null)
            this._styles._max = 0;
    };

    GridStack.prototype._update_styles = function(max_height) {
        if (this._styles == null) {
            return;
        }

        var prefix = '.' + this.opts._class + ' .' + this.opts.item_class;

        if (typeof max_height == 'undefined') {
            max_height = this._styles._max;
            this._init_styles();
            this._update_container_height();
        }

        if (this._styles._max == 0) {
            Utils.insert_css_rule(this._styles, prefix, 'min-height: ' + (this.opts.cell_height) + 'px;', 0);
        }

        if (max_height > this._styles._max) {
            for (var i = this._styles._max; i < max_height; ++i) {
                Utils.insert_css_rule(this._styles,
                    prefix + '[data-gs-height="' + (i + 1) + '"]',
                    'height: ' + (this.opts.cell_height * (i + 1) + this.opts.vertical_margin * i) + 'px;',
                    i
                );
                Utils.insert_css_rule(this._styles,
                    prefix + '[data-gs-min-height="' + (i + 1) + '"]',
                    'min-height: ' + (this.opts.cell_height * (i + 1) + this.opts.vertical_margin * i) + 'px;',
                    i
                );
                Utils.insert_css_rule(this._styles,
                    prefix + '[data-gs-max-height="' + (i + 1) + '"]',
                    'max-height: ' + (this.opts.cell_height * (i + 1) + this.opts.vertical_margin * i) + 'px;',
                    i
                );
                Utils.insert_css_rule(this._styles,
                    prefix + '[data-gs-y="' + i + '"]',
                    'top: ' + (this.opts.cell_height * i + this.opts.vertical_margin * i) + 'px;',
                    i
                );
            }
            this._styles._max = max_height;
        }
    };

    GridStack.prototype._update_container_height = function() {
        if (this.grid._update_counter) {
            return;
        }
        this.container.height(
            this.grid.get_grid_height() * (this.opts.cell_height + this.opts.vertical_margin) -
            this.opts.vertical_margin);
    };

    GridStack.prototype._is_one_column_mode = function() {
        return (window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth) <=
            this.opts.min_width;
    };

    GridStack.prototype._prepare_element = function(el) {
        var self = this;
        el = $(el);

        el.addClass(this.opts.item_class);

        var node = self.grid.add_node({
            x: el.attr('data-gs-x'),
            y: el.attr('data-gs-y'),
            width: el.attr('data-gs-width'),
            height: el.attr('data-gs-height'),
            max_width: el.attr('data-gs-max-width'),
            min_width: el.attr('data-gs-min-width'),
            max_height: el.attr('data-gs-max-height'),
            min_height: el.attr('data-gs-min-height'),
            minimized: el.attr('data-gs-minimized') == "true",
            auto_position: Utils.toBool(el.attr('data-gs-auto-position')),
            no_resize: Utils.toBool(el.attr('data-gs-no-resize')),
            no_move: Utils.toBool(el.attr('data-gs-no-move')),
            locked: Utils.toBool(el.attr('data-gs-locked')),
            el: el
        });
        el.data('_gridstack_node', node);

        if (self.opts.static_grid) {
            return;
        }

        var cell_width, cell_height;

        var drag_timeout,
            did_drag;

        var on_start_moving = function(event, ui) {
            did_drag = false;
            self.grid.make_room = self.opts.make_room_on_drag;
            self.container.append(self.placeholder);
            var o = $(this);
            self.grid.clean_nodes();
            self.grid.begin_update(node);
            cell_width = Math.ceil(o.outerWidth() / o.attr('data-gs-width'));
            cell_height = self.opts.cell_height + self.opts.vertical_margin;
            self.placeholder
                .attr('data-gs-x', o.attr('data-gs-x'))
                .attr('data-gs-y', o.attr('data-gs-y'))
                .attr('data-gs-width', o.attr('data-gs-width'))
                .attr('data-gs-height', o.attr('data-gs-height'))
                .show();
            node.el = self.placeholder;

            el.resizable('option', 'minWidth', cell_width * (node.min_width || 1));
            el.resizable('option', 'minHeight', self.opts.cell_height * (node.min_height || 1));
        };

        var on_end_moving = function(event, ui) {
            if (!did_drag) {
                on_drag(event, ui);
            } else {
                clearTimeout(drag_timeout);
            }

            self.grid.fit_to_height();
            self.grid.make_room = false;
            self.placeholder.detach();
            var o = $(this);
            node.el = o;
            self.placeholder.hide();
            o
                .attr('data-gs-x', node.x)
                .attr('data-gs-y', node.y)
                .attr('data-gs-width', node.width)
                .attr('data-gs-height', node.height)
                .removeAttr('style');
            self._update_container_height();
            self._trigger_change_event();

            self.grid.end_update();
        };

        var on_drag = function(event, ui) {
            did_drag = true;
            var x = Math.round(ui.position.left / cell_width),
                y = Math.floor((ui.position.top + cell_height / 2) / cell_height);
            if (!self.grid.can_move_node(node, x, y, node.width, node.height)) {
                console.log('cannot move there');
                return;
            }
            self.grid.move_node(node, x, y);
            self._update_container_height();
        };



        el.draggable(_.extend(this.opts.draggable, {
            start: on_start_moving,
            stop: on_end_moving,
            drag: function(event, ui) {
                clearTimeout(drag_timeout);

                drag_timeout = setTimeout(function() {
                    on_drag(event, ui);
                }, self.opts.drag_delay);
            },
            containment: this.opts.is_nested ? this.container.parent() : null
        })).resizable(_.extend(this.opts.resizable, {
            start: on_start_moving,
            stop: on_end_moving,
            resize: function(event, ui) {
                var x = Math.round(ui.position.left / cell_width),
                    y = Math.floor((ui.position.top + cell_height / 2) / cell_height),
                    width = Math.round(ui.size.width / cell_width),
                    height = Math.round(ui.size.height / cell_height);
                if (!self.grid.can_move_node(node, x, y, width, height)) {
                    return;
                }
                self.grid.move_node(node, x, y, width, height);
                self._update_container_height();
            }
        }));

        if (node.no_move || this._is_one_column_mode()) {
            el.draggable('disable');
        }

        if (node.no_resize || this._is_one_column_mode()) {
            el.resizable('disable');
        }

        el.attr('data-gs-locked', node.locked ? 'yes' : null);
    };

    GridStack.prototype.set_animation = function(enable) {
        if (enable) {
            this.container.addClass('grid-stack-animate');
        }
        else {
            this.container.removeClass('grid-stack-animate');
        }
    };

    GridStack.prototype.add_widget = function(el, x, y, width, height, auto_position) {
        el = $(el);
        if (typeof x != 'undefined') el.attr('data-gs-x', x);
        if (typeof y != 'undefined') el.attr('data-gs-y', y);
        if (typeof width != 'undefined') el.attr('data-gs-width', width);
        if (typeof height != 'undefined') el.attr('data-gs-height', height);
        if (typeof auto_position != 'undefined') el.attr('data-gs-auto-position', auto_position ? 'yes' : null);
        this.container.append(el);
        this._prepare_element(el);
        this._update_container_height();
        this._trigger_change_event(true);

        return el;
    };

    GridStack.prototype.will_it_fit = function(x, y, width, height, auto_position) {
        var node = {x: x, y: y, width: width, height: height, auto_position: auto_position};
        return this.grid.can_be_placed_with_respect_to_height(node);
    };

    GridStack.prototype.remove_widget = function(el, detach_node) {
        detach_node = typeof detach_node === 'undefined' ? true : detach_node;
        el = $(el);
        var node = el.data('_gridstack_node');
        this.grid.remove_node(node);
        el.removeData('_gridstack_node');
        this._update_container_height();
        if (detach_node)
            el.remove();
        this._trigger_change_event(true);
    };

    GridStack.prototype.remove_all = function(detach_node) {
        _.each(this.grid.nodes, function(node) {
            this.remove_widget(node.el, detach_node);
        }, this);
        this.grid.nodes = [];
        this._update_container_height();
    };

    GridStack.prototype.destroy = function() {
        $(window).off("resize", this.on_resize_handler);
        this.disable();
        this.container.remove();
        Utils.remove_stylesheet(this._styles_id);
        if (this.grid)
            this.grid = null;
    };

    GridStack.prototype.resizable = function(el, val) {
        el = $(el);
        el.each(function(index, el) {
            el = $(el);
            var node = el.data('_gridstack_node');
            if (typeof node == 'undefined' || node == null) {
                return;
            }

            node.no_resize = !(val || false);
            if (node.no_resize) {
                el.resizable('disable');
            }
            else {
                el.resizable('enable');
            }
        });
        return this;
    };

    GridStack.prototype.movable = function(el, val) {
        el = $(el);
        el.each(function(index, el) {
            el = $(el);
            var node = el.data('_gridstack_node');
            if (typeof node == 'undefined' || node == null) {
                return;
            }

            node.no_move = !(val || false);
            if (node.no_move) {
                el.draggable('disable');
            }
            else {
                el.draggable('enable');
            }
        });
        return this;
    };

    GridStack.prototype.disable = function() {
        this.movable(this.container.children('.' + this.opts.item_class), false);
        this.resizable(this.container.children('.' + this.opts.item_class), false);
    };

    GridStack.prototype.enable = function() {
        this.movable(this.container.children('.' + this.opts.item_class), true);
        this.resizable(this.container.children('.' + this.opts.item_class), true);
    };

    GridStack.prototype.locked = function(el, val) {
        el = $(el);
        el.each(function(index, el) {
            el = $(el);
            var node = el.data('_gridstack_node');
            if (typeof node == 'undefined' || node == null) {
                return;
            }

            node.locked = (val || false);
            el.attr('data-gs-locked', node.locked ? 'yes' : null);
        });
        return this;
    };

    GridStack.prototype.min_height = function (el, val) {
        el = $(el);
        el.each(function (index, el) {
          el = $(el);
          var node = el.data('_gridstack_node');
          if (typeof node == 'undefined' || node == null) {
            return;
          }

          if(!isNaN(val)){
            node.min_height = (val || false);
            el.attr('data-gs-min-height', val);
          }
        });
        return this;
    };

    GridStack.prototype.min_width = function (el, val) {
      el = $(el);
      el.each(function (index, el) {
      el = $(el);
      var node = el.data('_gridstack_node');
      if (typeof node == 'undefined' || node == null) {
        return;
      }

      if(!isNaN(val)){
        node.min_width = (val || false);
        el.attr('data-gs-min-width', val);
      }
    });
        return this;
    };

    GridStack.prototype._update_element = function(el, callback) {
        el = $(el).first();
        var node = el.data('_gridstack_node');
        if (typeof node == 'undefined' || node == null) {
            return;
        }

        var self = this;

        self.grid.clean_nodes();
        self.grid.begin_update(node);

        callback.call(this, el, node);

        self._update_container_height();
        self._trigger_change_event();

        self.grid.end_update();
    };

    GridStack.prototype.resize = function(el, width, height) {
        this._update_element(el, function(el, node) {
            width = (width != null && typeof width != 'undefined') ? width : node.width;
            height = (height != null && typeof height != 'undefined') ? height : node.height;

            this.grid.move_node(node, node.x, node.y, width, height);
        });
    };

    GridStack.prototype.move = function(el, x, y) {
        this._update_element(el, function(el, node) {
            x = (x != null && typeof x != 'undefined') ? x : node.x;
            y = (y != null && typeof y != 'undefined') ? y : node.y;

            this.grid.move_node(node, x, y, node.width, node.height);
        });
    };

    GridStack.prototype.update = function(el, x, y, width, height) {
        this._update_element(el, function(el, node) {
            x = (x != null && typeof x != 'undefined') ? x : node.x;
            y = (y != null && typeof y != 'undefined') ? y : node.y;
            width = (width != null && typeof width != 'undefined') ? width : node.width;
            height = (height != null && typeof height != 'undefined') ? height : node.height;

            this.grid.move_node(node, x, y, width, height);
        });
    };

    GridStack.prototype.cell_height = function(val) {
        if (typeof val == 'undefined') {
            return this.opts.cell_height;
        }
        val = parseInt(val);
        if (val == this.opts.cell_height)
            return;
        this.opts.cell_height = val || this.opts.cell_height;
        this._update_styles();
    };

    GridStack.prototype.cell_width = function() {
        var o = this.container.children('.' + this.opts.item_class).first();
        return Math.ceil(o.outerWidth() / o.attr('data-gs-width'));
    };

    GridStack.prototype.get_cell_from_pixel = function(position) {
        var containerPos = this.container.position();
        var relativeLeft = position.left - containerPos.left;
        var relativeTop = position.top - containerPos.top;

        var column_width = Math.floor(this.container.width() / this.opts.width);
        var row_height = this.opts.cell_height + this.opts.vertical_margin;

        return {x: Math.floor(relativeLeft / column_width), y: Math.floor(relativeTop / row_height)};
    };

    GridStack.prototype.batch_update = function() {
        this.grid.batch_update();
    };

    GridStack.prototype.commit = function() {
        this.grid.commit();
        this._update_container_height();
    };

    GridStack.prototype.is_area_empty = function(x, y, width, height) {
        return this.grid.is_area_empty(x, y, width, height);
    };

    GridStack.prototype.is_area_empty_and_will_it_fit = function(x, y, width, height, auto_position) {
        return (auto_position || this.is_area_empty(x, y, width, height)) &&
                this.will_it_fit(x, y, width, height, auto_position);
    };

    GridStack.prototype.try_moving_tile_y = function(x, y, width, height, rows) {
      var increment_y = 0,
          max_y = rows - height,
          fitting_y = y,
          fitted_previously = false;

      while (increment_y <= max_y) {
        var it_will_fit = this.is_area_empty_and_will_it_fit(x, increment_y, width, height, false);
        if (it_will_fit) {
          if (!fitted_previously) {
            fitting_y = increment_y;
            fitted_previously = true;
          }
        } else {
          fitted_previously = false;
        }
        increment_y += this.opts.y_fit_increment;
      }

      return fitting_y;
    };

    GridStack.prototype.try_shrinking_tile_height = function(x, y, width, height, min_height, auto_position) {
        for (var h = height-1; h >= min_height; h -= this.opts.y_fit_increment) {
            if (this.is_area_empty_and_will_it_fit(x, y, width, h, auto_position)) {
                return h;
            }
        }
        return false;
    };

    GridStack.prototype.focus_on_node_at = function(x, y, minimize_others) {
        this.grid.focus_on_node_at(x, y, minimize_others);
    };

    GridStack.prototype.minimize_node_at = function(x, y) {
        this.grid.minimize_node_at(x, y);
    };

    GridStack.prototype.set_static = function(static_value) {
        this.opts.static_grid = (static_value === true);
        this._set_static_class();
    };

    GridStack.prototype._set_static_class = function() {
        if (this.opts.static_grid === true) {
            this.container.addClass(this.opts.static_class);
        } else {
            this.container.removeClass(this.opts.static_class);
        }
    };

    scope.GridStackUI = GridStack;

    scope.GridStackUI.Utils = Utils;

    $.fn.gridstack = function(opts) {
        return this.each(function() {
            if (!$(this).data('gridstack')) {
                $(this).data('gridstack', new GridStack(this, opts));
            }
        });
    };

    return scope.GridStackUI;
});
