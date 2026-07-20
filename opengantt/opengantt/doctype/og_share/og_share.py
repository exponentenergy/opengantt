import json

import frappe
from frappe.utils import getdate, nowdate
from frappe.website.website_generator import WebsiteGenerator


class OGShare(WebsiteGenerator):
    def is_expired(self):
        if not self.published:
            return True
        if self.expires_on and getdate(self.expires_on) < getdate(nowdate()):
            return True
        return False

    def get_context(self, context):
        context.no_cache = 1
        # Never index public share pages
        context.metatags = {"robots": "noindex"}
        if self.is_expired():
            context.expired = 1
            context.snapshot = None
            context.http_status_code = 410
            try:
                frappe.local.response.http_status_code = 410
            except Exception:
                pass
            return context
        context.expired = 0
        try:
            context.snapshot = json.loads(self.snapshot) if self.snapshot else {}
        except Exception:
            context.snapshot = {}
        return context
