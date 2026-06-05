from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.config import get_settings
from app.devices.router import router as devices_router
from app.health import router as health_router
from app.live import live_router
from app.logging import configure_logging
from app.middleware.audit import AuditLogMiddleware
from app.middleware.tenant import TenantContextMiddleware
from app.properties_router import router as properties_router
from app.modules.admin.devices.router import router as admin_devices_router
from app.modules.admin.properties.router import router as admin_properties_router
from app.modules.admin.users.router import router as admin_users_router
from app.operations.router import router as operations_router
from app.bridges.router import router as bridges_router


def create_app() -> FastAPI:
    configure_logging()
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(AuditLogMiddleware)
    # Tenant must run before audit logging (sets request.state.principal).
    app.add_middleware(TenantContextMiddleware)
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(devices_router)
    app.include_router(properties_router)
    app.include_router(admin_users_router)
    app.include_router(admin_devices_router)
    app.include_router(admin_properties_router)
    app.include_router(operations_router)
    app.include_router(bridges_router)
    app.include_router(live_router)
    return app


app = create_app()
