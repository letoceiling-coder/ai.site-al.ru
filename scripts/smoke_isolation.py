import json
import time
import urllib.request as request
import http.cookiejar as cookiejar

BASE_URL = "https://ai.site-al.ru"
PASSWORD = "Pass12345!"


def build_client():
    jar = cookiejar.CookieJar()
    opener = request.build_opener(request.HTTPSHandler(), request.HTTPCookieProcessor(jar))
    return opener


def post(opener, path: str, payload: dict):
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        BASE_URL + path,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with opener.open(req, timeout=20) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def get(opener, path: str):
    req = request.Request(BASE_URL + path, method="GET")
    with opener.open(req, timeout=20) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def main():
    stamp = str(int(time.time()))
    user1 = f"iso-a-{stamp}@example.com"
    user2 = f"iso-b-{stamp}@example.com"

    c1 = build_client()
    c2 = build_client()

    post(c1, "/api/auth/register", {"displayName": "Iso A", "email": user1, "password": PASSWORD})
    post(c2, "/api/auth/register", {"displayName": "Iso B", "email": user2, "password": PASSWORD})

    post(c1, "/api/auth/login", {"email": user1, "password": PASSWORD})
    post(c2, "/api/auth/login", {"email": user2, "password": PASSWORD})

    post(c1, "/api/admin/leads", {"name": "Lead-A", "email": "lead-a@example.com"})

    status_1, leads_1 = get(c1, "/api/admin/leads")
    status_2, leads_2 = get(c2, "/api/admin/leads")

    items_1 = leads_1.get("data", {}).get("items", [])
    items_2 = leads_2.get("data", {}).get("items", [])

    has_a_in_1 = any(item.get("fullName") == "Lead-A" for item in items_1)
    has_a_in_2 = any(item.get("fullName") == "Lead-A" for item in items_2)

    print(
        json.dumps(
            {
                "status_1": status_1,
                "status_2": status_2,
                "account_1_items": len(items_1),
                "account_2_items": len(items_2),
                "lead_visible_in_account_1": has_a_in_1,
                "lead_visible_in_account_2": has_a_in_2,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
