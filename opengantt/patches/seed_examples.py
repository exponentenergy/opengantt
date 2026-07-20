"""Historical patch — intentionally a no-op.

Seeding now happens exclusively in opengantt.install.after_install and never
on migrate. An earlier version of this patch wiped all OpenGantt tables when
the example gantts were missing; that behavior is permanently removed. This
file stays so the patch entry in patches.txt remains valid for sites that
already ran it.
"""


def execute():
    return
