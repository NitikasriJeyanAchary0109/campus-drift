from typing import ClassVar, List, Optional, Union
from pydantic import AnyHttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

    PROJECT_NAME: str = "Campus Network Configuration-Drift Detector"
    VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Database
    DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/campus_drift"

    # Security & JWT
    # Development defaults only: Settings refuses to start with any of them when ENVIRONMENT=production.
    DEFAULT_SECRET_KEY: ClassVar[str] = "supersecretkeycampusdriftchangeinproduction1234567890"
    DEFAULT_ITSM_WEBHOOK_SECRET: ClassVar[str] = "itsm_webhook_shared_secret_campus_drift_2026"
    SECRET_KEY: str = DEFAULT_SECRET_KEY
    # Key material for the credential vault. Separate from SECRET_KEY (JWT signing) so that rotating one does not
    # invalidate the other. When unset (development only) the vault key is derived from SECRET_KEY.
    VAULT_KEY: Optional[str] = None
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ITSM_WEBHOOK_SECRET: str = DEFAULT_ITSM_WEBHOOK_SECRET

    # Redis & Celery
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/0"
    CELERY_TASK_ALWAYS_EAGER: bool = False
    CELERY_POLL_INTERVAL_SECONDS: float = 3600.0
    # Run remediation apply/rollback (SSH push, verify, auto-rollback) on the Celery worker instead of inside the HTTP request.
    # Unset = on in production, off otherwise (so a development API works without a worker).
    REMEDIATION_USE_QUEUE: Optional[bool] = None

    # ITSM webhook replay protection: when on, every delivery must carry X-ITSM-Timestamp (epoch seconds) and sign
    # "<timestamp>.<body>"; deliveries older or newer than the tolerance are refused. Unset = on in production.
    ITSM_REQUIRE_TIMESTAMP: Optional[bool] = None
    ITSM_TIMESTAMP_TOLERANCE_SECONDS: int = 300
    # A change is dated by the poll that noticed it. Between two polls it could have happened any time, so a ticket window
    # is matched against [previous poll, this poll], but never further back than this (an unpolled device must not
    # let an old ticket cover anything).
    ITSM_MAX_DETECTION_LAG_MINUTES: int = 360

    # Remediation execution
    REMEDIATION_SAVE_CONFIG: bool = True            # write memory after a verified change, so a reload keeps the fix
    ROLLBACK_RETRY_DELAY_SECONDS: float = 3.0       # pause before the 2nd and 3rd restore attempt (x attempt number)
    ROLLBACK_TARGET_SECONDS: int = 60               # a verified restore slower than this is still a rollback, but the audit entry and alert say it was late
    ROLLBACK_AUTO_RETRIES: int = 3                  # delayed Celery retries of a restore that could not be verified
    ROLLBACK_AUTO_RETRY_DELAY_SECONDS: int = 120
    # Lab-only hooks: ?force_fail= on apply and the simulator reset command sent during a rollback. Unset = on outside production.
    ALLOW_TEST_HOOKS: Optional[bool] = None

    # SSH to devices: verify host keys against a known_hosts file (required in production)
    SSH_STRICT_HOST_KEYS: bool = False
    SSH_KNOWN_HOSTS_FILE: Optional[str] = None

    # Sign-in protection
    LOGIN_MAX_FAILURES: int = 5
    LOGIN_FAILURE_WINDOW_SECONDS: int = 900

    # CORS
    CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, str) and v.startswith("["):
            import json
            return json.loads(v)
        elif isinstance(v, (list, tuple)):
            return [str(i) for i in v]
        return []

    @model_validator(mode="after")
    def default_remediation_queue(self) -> "Settings":
        production = self.ENVIRONMENT.lower() == "production"
        if self.REMEDIATION_USE_QUEUE is None:
            self.REMEDIATION_USE_QUEUE = production
        if self.ITSM_REQUIRE_TIMESTAMP is None:
            self.ITSM_REQUIRE_TIMESTAMP = production
        if self.ALLOW_TEST_HOOKS is None:
            self.ALLOW_TEST_HOOKS = not production
        return self

    @model_validator(mode="after")
    def refuse_insecure_production_config(self) -> "Settings":
        """Fail at startup (not at first request) when a production deployment still uses development secrets."""
        if self.ENVIRONMENT.lower() != "production":
            return self
        problems: List[str] = []
        if self.SECRET_KEY == self.DEFAULT_SECRET_KEY or len(self.SECRET_KEY) < 32:
            problems.append("SECRET_KEY is the committed default or shorter than 32 characters")
        if not self.VAULT_KEY or len(self.VAULT_KEY) < 32:
            problems.append("VAULT_KEY is not set or shorter than 32 characters")
        elif self.VAULT_KEY == self.SECRET_KEY:
            problems.append("VAULT_KEY must differ from SECRET_KEY")
        if self.ITSM_WEBHOOK_SECRET == self.DEFAULT_ITSM_WEBHOOK_SECRET:
            problems.append("ITSM_WEBHOOK_SECRET is the committed default")
        if self.DEBUG:
            problems.append("DEBUG must be false")
        if not self.SSH_STRICT_HOST_KEYS or not self.SSH_KNOWN_HOSTS_FILE:
            problems.append("SSH_STRICT_HOST_KEYS must be true and SSH_KNOWN_HOSTS_FILE set (device host keys are verified)")
        if self.ALLOW_TEST_HOOKS:
            problems.append("ALLOW_TEST_HOOKS must be false")
        if not self.ITSM_REQUIRE_TIMESTAMP:
            problems.append("ITSM_REQUIRE_TIMESTAMP must be true")
        if problems:
            raise ValueError("Refusing to start with ENVIRONMENT=production: " + "; ".join(problems))
        return self


settings = Settings()
