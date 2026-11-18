# -*- coding: utf-8 -*-
"""
Pre-migration: merge wincraft.profile.system into the Profile Type model
(wincraft.window.type.series).

"Profile System" was a development mistake: the app uses a single Profile Type.
The Profile Type model (technical name wincraft.window.type.series) now carries
the engineering attributes that lived on the profile system, and every
`profile_system_id` Many2one becomes `profile_type_id` on that model.

Runs before Odoo syncs the schema, in raw SQL (the old model class is gone):

1. Add the new attribute columns to wincraft_window_type_series.
2. For each profile system, merge it into an unclaimed Profile Type with the
   same name, or create a new Profile Type from it.
3. Re-point every `profile_system_id` column to `profile_type_id` using that
   mapping, then drop the old column.
4. Re-point the XML ids of seeded profile systems (profile_upvc_classic, ...)
   to the Profile Type rows so existing data/defaults/rules keep resolving.
5. Rename wincraft_window_type.series_id -> profile_type_id.

Where a window had both a profile system and a (popup) profile type, the
profile system wins: it is what drove BOM/pricing, so no costed window changes.
The old wincraft_profile_system table is left for Odoo to drop with the model.
Idempotent: a no-op once the old table is gone (fresh install / already run).
"""
import logging

_logger = logging.getLogger(__name__)

NEW_COLUMNS = [
    ('material_type', 'varchar'),
    ('available_depths', 'jsonb'),
    ('default_depth_mm', 'int4'),
    ('mullion_width_mm', 'int4'),
    ('max_sash_weight_kg', 'numeric'),
    ('max_span_mm', 'int4'),
    ('rate_per_metre', 'numeric'),
    ('currency_id', 'int4'),
    ('u_value', 'numeric'),
    ('colour_options', 'jsonb'),
    ('material_id', 'int4'),
    ('description', 'jsonb'),
]
COPY_COLUMNS = [c for c, _t in NEW_COLUMNS]


def _columns(cr, table):
    cr.execute("SELECT column_name FROM information_schema.columns WHERE table_name = %s", (table,))
    return {r[0] for r in cr.fetchall()}


def migrate(cr, version):
    cr.execute("SELECT to_regclass('public.wincraft_profile_system')")
    has_system_table = bool(cr.fetchone()[0])
    cr.execute("SELECT to_regclass('public.wincraft_window_type_series')")
    has_series_table = bool(cr.fetchone()[0])

    # 5. series_id -> profile_type_id on window types (independent of the rest)
    cr.execute("SELECT to_regclass('public.wincraft_window_type')")
    if cr.fetchone()[0]:
        cols = _columns(cr, 'wincraft_window_type')
        if 'series_id' in cols and 'profile_type_id' not in cols:
            cr.execute("ALTER TABLE wincraft_window_type RENAME COLUMN series_id TO profile_type_id")

    if not has_system_table:
        return
    if not has_series_table:
        # Profile systems exist but the series table was never created; make a
        # minimal one so the data can be carried across (Odoo completes it).
        cr.execute("""
            CREATE TABLE wincraft_window_type_series (
                id serial PRIMARY KEY, name jsonb NOT NULL,
                sequence int4, active bool,
                create_uid int4, create_date timestamp, write_uid int4, write_date timestamp)
        """)

    # 1. attribute columns
    existing = _columns(cr, 'wincraft_window_type_series')
    for col, typ in NEW_COLUMNS:
        if col not in existing:
            cr.execute('ALTER TABLE wincraft_window_type_series ADD COLUMN "%s" %s' % (col, typ))

    # 2. merge / create
    cr.execute("SELECT id FROM wincraft_profile_system ORDER BY sequence, id")
    system_ids = [r[0] for r in cr.fetchall()]
    mapping = {}
    claimed = set()
    set_clause = ", ".join('"%s" = ps."%s"' % (c, c) for c in COPY_COLUMNS)
    for sid in system_ids:
        cr.execute("""
            SELECT s.id FROM wincraft_window_type_series s, wincraft_profile_system ps
            WHERE ps.id = %s AND s.name::text = ps.name::text AND s.id NOT IN %s
            ORDER BY s.id LIMIT 1
        """, (sid, tuple(claimed) or (0,)))
        row = cr.fetchone()
        if row:
            tid = row[0]
            cr.execute("UPDATE wincraft_window_type_series s SET %s FROM wincraft_profile_system ps "
                       "WHERE ps.id = %%s AND s.id = %%s" % set_clause, (sid, tid))
        else:
            cols = ", ".join(['name', 'sequence', 'active'] + ['"%s"' % c for c in COPY_COLUMNS])
            vals = ", ".join(['ps.name', 'ps.sequence', 'ps.active'] + ['ps."%s"' % c for c in COPY_COLUMNS])
            cr.execute("INSERT INTO wincraft_window_type_series (%s) SELECT %s FROM wincraft_profile_system ps "
                       "WHERE ps.id = %%s RETURNING id" % (cols, vals), (sid,))
            tid = cr.fetchone()[0]
        mapping[sid] = tid
        claimed.add(tid)

    # Profile Types that did not come from a profile system get engineering defaults
    cr.execute("""
        UPDATE wincraft_window_type_series SET
            material_type = COALESCE(material_type, 'upvc'),
            available_depths = COALESCE(available_depths, '[40, 70, 90]'::jsonb),
            default_depth_mm = COALESCE(default_depth_mm, 70),
            mullion_width_mm = COALESCE(mullion_width_mm, 20),
            max_sash_weight_kg = COALESCE(max_sash_weight_kg, 80.0),
            max_span_mm = COALESCE(max_span_mm, 1500),
            rate_per_metre = COALESCE(rate_per_metre, 0.0),
            u_value = COALESCE(u_value, 1.4),
            colour_options = COALESCE(colour_options, '[]'::jsonb)
    """)

    # 3. re-point every profile_system_id column
    cr.execute("""
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'profile_system_id' AND table_schema = 'public'
    """)
    for (table,) in cr.fetchall():
        if 'profile_type_id' not in _columns(cr, table):
            cr.execute('ALTER TABLE "%s" ADD COLUMN profile_type_id int4' % table)
        for sid, tid in mapping.items():
            if table == 'wincraft_window':
                # the profile system drove BOM/pricing -> it wins over a popup profile type
                cr.execute('UPDATE "%s" SET profile_type_id = %%s WHERE profile_system_id = %%s' % table, (tid, sid))
            else:
                cr.execute('UPDATE "%s" SET profile_type_id = %%s WHERE profile_system_id = %%s '
                           'AND profile_type_id IS NULL' % table, (tid, sid))
        # dropping the column also drops its FK and any unique constraint on it
        cr.execute('ALTER TABLE "%s" DROP COLUMN profile_system_id CASCADE' % table)
        _logger.info('wincraft_studio migration: %s.profile_system_id merged into profile_type_id', table)

    # 4. XML ids of seeded profile systems -> Profile Type rows
    for sid, tid in mapping.items():
        cr.execute("""
            UPDATE ir_model_data SET model = 'wincraft.window.type.series', res_id = %s
            WHERE model = 'wincraft.profile.system' AND res_id = %s
        """, (tid, sid))
    _logger.info('wincraft_studio migration: %d profile system(s) merged into Profile Types', len(mapping))
