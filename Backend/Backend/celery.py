import os
import ssl
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Backend.settings')

# Sanitize any rediss:// in environment variables before Celery loads them
for env_key in ['CELERY_BROKER_URL', 'CELERY_RESULT_BACKEND', 'REDIS_URL']:
    val = os.getenv(env_key)
    if val and 'rediss://' in val and 'ssl_cert_reqs' not in val:
        sep = '&' if '?' in val else '?'
        os.environ[env_key] = f"{val}{sep}ssl_cert_reqs=CERT_NONE"

app = Celery('Backend')

app.config_from_object('django.conf:settings', namespace='CELERY')

# Also explicitly set on app.conf
if 'rediss://' in str(app.conf.broker_url) and 'ssl_cert_reqs' not in str(app.conf.broker_url):
    sep = '&' if '?' in str(app.conf.broker_url) else '?'
    app.conf.broker_url = f"{app.conf.broker_url}{sep}ssl_cert_reqs=CERT_NONE"

if 'rediss://' in str(app.conf.result_backend) and 'ssl_cert_reqs' not in str(app.conf.result_backend):
    sep = '&' if '?' in str(app.conf.result_backend) else '?'
    app.conf.result_backend = f"{app.conf.result_backend}{sep}ssl_cert_reqs=CERT_NONE"

app.autodiscover_tasks()