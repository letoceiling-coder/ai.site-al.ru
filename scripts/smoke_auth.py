import json
import time
from urllib import request

base = "https://ai.site-al.ru"
ts = str(int(time.time()))
tenant_slug = f"smoke-{ts}"
email = f"smoke-{ts}@example.com"
password = "StartPass123!"
new_password = "NewPass123!"

opener = request.build_opener(request.HTTPSHandler())


def post(path: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(base + path, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with opener.open(req, timeout=30) as resp:
            return resp.status, dict(resp.headers), resp.read().decode("utf-8")
    except Exception as exc:
        if hasattr(exc, "code"):
            return exc.code, dict(exc.headers), exc.read().decode("utf-8")
        raise


results = {}

status, headers, body = post(
    "/api/auth/register",
    {
        "tenantName": "Smoke Tenant",
        "tenantSlug": tenant_slug,
        "displayName": "Smoke User",
        "email": email,
        "password": password,
    },
)
results["register"] = {"status": status, "body": body[:300]}

status, headers, body = post(
    "/api/auth/login",
    {
        "tenantSlug": tenant_slug,
        "email": email,
        "password": password,
    },
)
results["login_initial"] = {
    "status": status,
    "body": body[:300],
    "set_cookie": headers.get("Set-Cookie", "")[:180],
}

status, headers, body = post(
    "/api/auth/forgot-password",
    {
        "tenantSlug": tenant_slug,
        "email": email,
    },
)
results["forgot_password"] = {"status": status, "body": body[:500]}
token = ""
try:
    parsed = json.loads(body)
    token = parsed.get("data", {}).get("resetTokenPreview", "")
except Exception:
    token = ""

status, headers, body = post(
    "/api/auth/reset-password",
    {
        "token": token,
        "password": new_password,
    },
)
results["reset_password"] = {"status": status, "body": body[:300]}

status, headers, body = post(
    "/api/auth/login",
    {
        "tenantSlug": tenant_slug,
        "email": email,
        "password": new_password,
    },
)
results["login_after_reset"] = {"status": status, "body": body[:300]}

print(
    json.dumps(
        {
            "tenant_slug": tenant_slug,
            "email": email,
            "results": results,
        },
        ensure_ascii=False,
        indent=2,
    )
)
